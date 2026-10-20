// cleanup-gh-releases.mjs
// 用途：CI 发布后清理重复的 GitHub Release（electron-builder 并行发布竞态兜底）
// 规则：对每个 tag，若存在多个 Release，保留资产最多的一个，删除其余。
// 环境变量：GH_TOKEN（GitHub Actions 自动注入的 GITHUB_TOKEN）、GITHUB_REPOSITORY（owner/repo）
import { execSync } from 'node:child_process'

const token = process.env.GH_TOKEN
const repo = process.env.GITHUB_REPOSITORY || 'dalinv/beam-screen-pusher'
if (!token) {
  console.log('未检测到 GH_TOKEN，跳过清理（本地/非 CI 环境）')
  process.exit(0)
}

const api = 'https://api.github.com'
const headers = { Authorization: `token ${token}`, 'User-Agent': 'beam-cleanup', Accept: 'application/vnd.github+json' }

// 获取全部 releases（含已发布，不含 draft；分页 100 足够）
const res = await fetch(`${api}/repos/${repo}/releases?per_page=100`, { headers })
if (!res.ok) {
  console.log(`获取 releases 失败: ${res.status} ${res.statusText}，跳过清理`)
  process.exit(0)
}
const releases = await res.json()

// 按 tag 分组
const byTag = new Map()
for (const r of releases) {
  if (!byTag.has(r.tag_name)) byTag.set(r.tag_name, [])
  byTag.get(r.tag_name).push(r)
}

let deleted = 0
for (const [tag, list] of byTag) {
  if (list.length <= 1) continue
  // 按资产数降序，保留第一个（资产最多的）
  list.sort((a, b) => b.assets.length - a.assets.length)
  const keep = list[0]
  console.log(`tag ${tag}: ${list.length} 个 Release，保留 id=${keep.id}（资产 ${keep.assets.length}），删除 ${list.length - 1} 个`)
  for (const r of list.slice(1)) {
    const del = await fetch(`${api}/repos/${repo}/releases/${r.id}`, { method: 'DELETE', headers })
    if (del.ok || del.status === 204) {
      console.log(`  已删除重复 Release id=${r.id} (${r.tag_name})`)
      deleted++
    } else {
      console.log(`  删除失败 id=${r.id}: ${del.status} ${del.statusText}`)
    }
  }
}
console.log(deleted === 0 ? '无重复 Release，无需清理' : `共清理 ${deleted} 个重复 Release`)
