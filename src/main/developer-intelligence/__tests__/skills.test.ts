import { describe, expect, it } from 'vitest'
import type { DeveloperSkill } from '@shared/contracts/developer-intelligence'
import { messageRequestsSkill, parseSkillDocument, skillsForContext } from '../skills'

function skill(name: string, description: string): DeveloperSkill {
  return {
    id: name,
    name,
    description,
    instructions: 'Follow this when the matching work comes up.',
    source: 'user',
    enabled: true,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('skill documents', () => {
  it('reads a markdown skill with frontmatter', () => {
    const [draft] = parseSkillDocument(`---
name: Review
description: Use when reviewing a change
---
Check the diff before suggesting a rewrite.
`)
    expect(draft).toMatchObject({
      name: 'Review',
      description: 'Use when reviewing a change',
      instructions: 'Check the diff before suggesting a rewrite.'
    })
  })

  it('reads one skill or a list from JSON', () => {
    expect(parseSkillDocument(JSON.stringify({
      name: 'Tests',
      description: 'When tests are requested',
      instructions: 'Run the nearest test file before calling the work done.'
    }))).toHaveLength(1)
    expect(parseSkillDocument(JSON.stringify({
      skills: [
        { name: 'Alpha', description: 'First skill', instructions: 'Do the first thing carefully.' },
        { name: 'B', instructions: 'short' }
      ]
    }))).toHaveLength(1)
  })

  it('saves a skill only when the user asks for one', () => {
    expect(messageRequestsSkill('Save this as a skill: review diffs first')).toBe(true)
    expect(messageRequestsSkill('bunu skill olarak kaydet')).toBe(true)
    expect(messageRequestsSkill('skill oluşturalım ve mevcut skilleri geliştir')).toBe(true)
    expect(messageRequestsSkill('analyze my skills')).toBe(false)
    expect(messageRequestsSkill('Review the login form')).toBe(false)
  })

  it('prefers skills that match the request', () => {
    const ranked = skillsForContext([
      skill('Review', 'Use when reviewing a diff'),
      skill('Release', 'Use when preparing a release')
    ], 'Please review this diff')
    expect(ranked[0]?.name).toBe('Review')
  })
})
