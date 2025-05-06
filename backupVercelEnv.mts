#!/usr/bin/env node

import axios from "axios";
import fs from "fs-extra";
import path from "path";

type VercelProject = {
  id: string;
  name: string;
  slug: string;
  teamId: string;
  createdAt: string;
  updatedAt: string;
};

type VercelEnv = {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
};

type VercelEnvResponse = {
  envs: VercelEnv[];
};

type VercelTeam = {
  id: string;
  name: string;
  slug: string;
};

// Load token
const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.error("Error: set VERCEL_TOKEN in your environment");
  process.exit(1);
}

const api = axios.create({
  baseURL: "https://api.vercel.com",
  headers: { Authorization: `Bearer ${token}` },
});

async function getTeams() {
  // Vercel v2 endpoint for listing teams
  const res: { data: { teams: VercelTeam[] } } = await api.get("/v2/teams", {
    params: { limit: 100 },
  });
  return res.data.teams || [];
}

async function listProjects(teamId: string | null) {
  if (!teamId) return [];

  let all = [];
  let until = null;

  do {
    const res: {
      data: { projects: VercelProject[]; pagination: { until: string | null } };
    } = await api.get("/v9/projects", {
      params: {
        limit: 100,
        until,
        ...(teamId ? { teamId } : {}),
      },
    });
    all.push(...res.data.projects);
    until = res.data.pagination.until;
  } while (until);
  return all;
}

async function backup() {
  // 1) Build list of scopes: personal + each team
  const scopes = [];
  const teams = await getTeams();
  for (const t of teams) {
    scopes.push({ id: t.id, name: t.slug });
  }

  // 2) Make timestamped root folder
  const timestamp = new Date().toISOString().replace(/:/g, "-").split(".")[0];
  const root = path.join(
    process.cwd(),
    "backups",
    timestamp ?? new Date().toISOString()
  );
  await fs.ensureDir(root);

  // 3) For each scope, fetch projects & envs
  for (const scope of scopes) {
    const projectList = await listProjects(scope.id);
    if (!projectList.length) continue;

    const scopeDir = path.join(root, scope.name);
    await fs.ensureDir(scopeDir);

    console.log(
      `Backing up ${projectList.length} projects for "${scope.name}"…`
    );

    for (const project of projectList) {
      const envRes = await api.get<VercelEnvResponse>(
        `/v9/projects/${project.id}/env`,
        scope.id ? { params: { teamId: scope.id } } : {}
      );
      const envs = envRes.data.envs || [];
      const out = path.join(scopeDir, `${project.name}.json`);
      await fs.writeJson(out, envs, { spaces: 2 });
      console.log(`  • ${project.name} → ${envs.length} vars`);
    }
  }

  console.log(`✅ Backup complete: ${root}`);
}

backup().catch((err) => {
  console.error("Backup failed:", err.response?.data || err.message);
  process.exit(1);
});
