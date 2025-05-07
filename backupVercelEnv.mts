#!/usr/bin/env bun

import { Vercel } from "@vercel/sdk";
import fs from "fs-extra";
import path from "path";

// Load token
const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.error("Error: set VERCEL_TOKEN in your environment");
  process.exit(1);
}

const vercel = new Vercel({
  bearerToken: token,
});

async function getTeams() {
  return (await vercel.teams.getTeams({})).teams;
}

async function listProjects(teamId: string | null) {
  if (!teamId) return [];

  return (
    await vercel.projects.getProjects({
      teamId,
      limit: "200",
    })
  ).projects;
}

async function backup() {
  // 1) Build list of scopes: personal + each team
  const scopes = await getTeams();

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

    const scopeDir = path.join(root, scope.slug);
    await fs.ensureDir(scopeDir);

    console.info(
      `Backing up ${projectList.length} projects for "${scope.slug}"…`
    );

    for (const project of projectList) {
      const envRes = await vercel.projects.filterProjectEnvs({
        idOrName: project.id,
        teamId: scope.id,
      });

      // if the envRes doesn't have envs, skip
      if (!("envs" in envRes)) continue;

      const envs = envRes.envs;

      const out = path.join(scopeDir, `${project.name}.json`);

      await fs.writeJson(out, envRes.envs, { spaces: 2 });
      console.info(`  • ${project.name} → ${envs.length} vars`);
    }
  }

  console.info(`✅ Backup complete: ${root}`);
}

backup().catch((err) => {
  console.error("Backup failed:", err.response?.data || err.message);
  process.exit(1);
});
