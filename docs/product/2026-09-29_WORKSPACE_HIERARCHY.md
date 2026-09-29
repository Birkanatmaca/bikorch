# Workspace-first product hierarchy

Bikorch is a desktop developer workspace for working with multiple AI coding agents. A project opens the workspace directly. The user can start an agent or terminal, use files and Git, and review the result in Agent Work & Changes without connecting or opening Manager.

## Navigation

| Level | Surface | Existing implementation |
| --- | --- | --- |
| Workspace | Projects, agents, terminal, files, Git, browser and previews | Project tabs, canvas, Add Panel menu, Files and CLI accounts |
| Agent Work & Changes | Working, Ready, Review recommended, Needs attention, Apply to Project | Shared isolation lanes and Git changes panel |
| Manager | Chat, plans, operations and results | Optional right sidebar; starts closed until selected |
| Intelligence | Memory, Skills, Developer Profile, Daily Learn | Intelligence sidebar and profile sections |
| Tools | Tasks, Music/Downloader, Timer, resources and settings | Collapsed rail group, Music, Profile settings and Runtime |

The Add Panel menu places agents and terminal first, workspace panels second, and auxiliary panels last. Automation remains in the codebase but is not promoted in the primary navigation while its product flow is unfinished.

## Work flows

1. **Manual:** Open a project, start an agent or terminal, then review and apply work in Agent Work & Changes.
2. **Managed:** Open a project, choose Manager, review a plan, then review and apply the resulting agent work in the same Agent Work & Changes area.

Manual and Manager-launched agents retain their existing internal panel roles for dispatch and recovery, but use the same isolation lanes, worktree review, and apply controls. This restructuring changes navigation and copy, not persisted project, run, memory, or worktree contracts.
