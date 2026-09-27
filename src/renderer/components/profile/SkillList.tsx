import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useDeveloperIntelligenceStore } from '@renderer/stores/developer-intelligence-store'
import { buttonStyles } from '@renderer/components/ui/Button'
import { Toggle } from './ProfilePrimitives'

export function SkillList(): React.JSX.Element {
  const skills = useDeveloperIntelligenceStore((state) => state.skills)
  const skillsLoaded = useDeveloperIntelligenceStore((state) => state.skillsLoaded)
  const loadSkills = useDeveloperIntelligenceStore((state) => state.loadSkills)
  const createSkill = useDeveloperIntelligenceStore((state) => state.createSkill)
  const updateSkill = useDeveloperIntelligenceStore((state) => state.updateSkill)
  const deleteSkill = useDeveloperIntelligenceStore((state) => state.deleteSkill)
  const importSkill = useDeveloperIntelligenceStore((state) => state.importSkill)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!skillsLoaded) void loadSkills()
  }, [skillsLoaded, loadSkills])

  const submit = async (): Promise<void> => {
    const trimmedName = name.trim()
    const trimmedInstructions = instructions.trim()
    if (!trimmedName || trimmedInstructions.length < 8) return
    setStatus(null)
    try {
      await createSkill({
        name: trimmedName,
        description: description.trim() || trimmedName,
        instructions: trimmedInstructions
      })
      setName('')
      setDescription('')
      setInstructions('')
      setAdding(false)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save the skill.')
    }
  }

  const importFile = async (): Promise<void> => {
    setStatus(null)
    try {
      const count = await importSkill()
      if (count > 0) setStatus(count === 1 ? '1 skill imported.' : `${count} skills imported.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not import that file.')
    }
  }

  return (
    <section className="profile-skill-shell">
      <div className="profile-skill-heading">
        <h3>Skills</h3>
        <div>
          <button type="button" className={buttonStyles({ variant: 'secondary', size: 'sm' })} onClick={() => void importFile()}>
            Import
          </button>
          <button type="button" className={buttonStyles({ variant: 'secondary', size: 'sm' })} onClick={() => setAdding((open) => !open)}>
            {adding ? 'Close' : 'Add'}
          </button>
        </div>
      </div>
      {adding && (
        <form
          className="profile-skill-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" aria-label="Skill name" maxLength={80} required />
          <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="When to use it" aria-label="Skill description" maxLength={280} />
          <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="How Manager should work" aria-label="Skill instructions" rows={4} maxLength={4000} required />
          <button type="submit" className={buttonStyles({ variant: 'primary', size: 'sm' })} disabled={!name.trim() || instructions.trim().length < 8}>
            Save
          </button>
        </form>
      )}
      {skills.length === 0 ? null : (
        <ul className="profile-skill-list">
          {skills.map((skill) => (
            <li key={skill.id}>
              <div>
                <strong>{skill.name}</strong>
                <span>{skill.description}</span>
              </div>
              <Toggle
                checked={skill.enabled}
                onChange={(enabled) => void updateSkill(skill.id, { enabled })}
                ariaLabel={skill.enabled ? 'Disable skill' : 'Enable skill'}
              />
              <button
                type="button"
                aria-label="Delete skill"
                onClick={() => {
                  if (window.confirm('Delete this skill?')) void deleteSkill(skill.id)
                }}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {status && <p className="profile-brain-feedback" role="status">{status}</p>}
    </section>
  )
}
