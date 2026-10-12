# Codex Home visual direction

The supplied prompt's SpaceX-inspired specification is the source of truth. No separate original DESIGN.md existed in the initial repository.

| Token                | Value                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| Primary background   | #000000                                                                                           |
| Secondary background | #0A0A0A                                                                                           |
| Primary text         | #FFFFFF                                                                                           |
| Secondary text       | #F0F0FA                                                                                           |
| Hairline borders     | #3A3A3F                                                                                           |
| Display type         | Industrial condensed uppercase; Barlow Condensed as a freely available D-DIN-inspired alternative |
| Interface type       | Inter with system fallbacks                                                                       |
| Code type            | IBM Plex Mono with Consolas/monospace fallbacks                                                   |

Minimal navigation; outlined pill actions; strong whitespace; restrained green, amber and red for actual state. No gradients, glassmorphism, decorative photography or shadows. Compact typography for logs, repository details and diffs. The detail panel collapses. Mobile navigation stays compact, task forms stack, and code scrolls independently.

All shared tokens live in `web/styles.css`; reusable controls live in `web/components.tsx`. Font files are self-hosted in production; system fallbacks keep offline access functional.
