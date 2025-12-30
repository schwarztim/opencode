import { test, expect } from "bun:test"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"

test("discovers skills from .opencode/skill/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "test-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: test-skill
description: A test skill for verification.
---

# Test Skill

Instructions here.
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      // Should find local skill + global skill from test home
      expect(skills.length).toBe(2)
      const testSkill = skills.find((s) => s.name === "test-skill")
      expect(testSkill).toBeDefined()
      expect(testSkill!.description).toBe("A test skill for verification.")
      expect(testSkill!.location).toContain("skill/test-skill/SKILL.md")
    },
  })
})

test("discovers multiple skills from .opencode/skill/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "my-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: my-skill
description: Another test skill.
---

# My Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      // Should find local skill + global skill from test home
      expect(skills.length).toBe(2)
      const mySkill = skills.find((s) => s.name === "my-skill")
      expect(mySkill).toBeDefined()
    },
  })
})

test("skips skills with missing frontmatter", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".opencode", "skill", "no-frontmatter")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `# No Frontmatter

Just some content without YAML frontmatter.
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      // Should only find the global skill, not the one without frontmatter
      expect(skills.length).toBe(1)
      expect(skills[0].name).toBe("global-test-skill")
    },
  })
})

test("discovers skills from .claude/skills/ directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const skillDir = path.join(dir, ".claude", "skills", "claude-skill")
      await Bun.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      // Should find both project-local and global skill
      expect(skills.length).toBe(2)
      const claudeSkill = skills.find((s) => s.name === "claude-skill")
      const globalSkill = skills.find((s) => s.name === "global-test-skill")
      expect(claudeSkill).toBeDefined()
      expect(claudeSkill!.location).toContain(".claude/skills/claude-skill/SKILL.md")
      expect(globalSkill).toBeDefined()
      expect(globalSkill!.description).toBe("A global skill from ~/.claude/skills for testing.")
    },
  })
})

test("discovers global skills from ~/.claude/skills/ directory", async () => {
  // Create a project with no local skills - should still find global skill
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const skills = await Skill.all()
      expect(skills.length).toBe(1)
      expect(skills[0].name).toBe("global-test-skill")
      expect(skills[0].description).toBe("A global skill from ~/.claude/skills for testing.")
      expect(skills[0].location).toContain(".claude/skills/global-test-skill/SKILL.md")
    },
  })
})

test("returns empty array when no skills exist", async () => {
  await using tmp = await tmpdir({ git: true })

  // Override global home to a directory without any skills
  const originalHome = process.env.OPENCODE_TEST_HOME
  process.env.OPENCODE_TEST_HOME = tmp.path

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        expect(skills).toEqual([])
      },
    })
  } finally {
    process.env.OPENCODE_TEST_HOME = originalHome
  }
})
