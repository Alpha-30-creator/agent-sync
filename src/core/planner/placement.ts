/**
 * Where to physically write a project-scope skill (docs/04-sync-model.md §7).
 *
 * Cursor also reads `.claude/skills`, `.codex/skills`, and `.agents/skills` inside a
 * project, so *placement* and *discovery* are different things. Two consequences this
 * module handles honestly:
 *
 *  - Writing one copy can satisfy several agents, so we write the minimum set.
 *  - Excluding Cursor from a project skill is sometimes impossible, because it reads
 *    another agent's directory. We report that rather than pretending it worked.
 */
import type { AgentId } from '../model/types.js';

export interface AgentPlacement {
  readonly agent: AgentId;
  /** Directory this agent reads its own skills from, relative to the project root. */
  readonly ownDir: string;
  /** Other directories this agent also discovers skills in. */
  readonly alsoDiscovers: readonly string[];
}

export interface PlacementResult {
  /** Directories to write into, each covering one or more routed agents. */
  readonly writes: readonly { readonly dir: string; readonly satisfies: readonly AgentId[] }[];
  /**
   * Agents that will see the skill even though it was not routed to them, because
   * they discover a directory we had to write for someone else.
   */
  readonly notExcludable: readonly { readonly agent: AgentId; readonly via: string }[];
}

const discovers = (placement: AgentPlacement, dir: string): boolean =>
  placement.ownDir === dir || placement.alsoDiscovers.includes(dir);

/**
 * Choose the fewest directories that cover every routed agent.
 *
 * Agents are considered in the given order, so an agent that discovers other
 * directories (Cursor) is covered by an earlier write when one exists.
 */
export const placeProjectSkill = (
  targets: readonly AgentId[],
  placements: readonly AgentPlacement[],
): PlacementResult => {
  const routed = placements.filter((placement) => targets.includes(placement.agent));
  const chosen: { dir: string; satisfies: AgentId[] }[] = [];

  for (const placement of routed) {
    const covering = chosen.find((write) => discovers(placement, write.dir));
    if (covering !== undefined) {
      covering.satisfies.push(placement.agent);
      continue;
    }
    chosen.push({ dir: placement.ownDir, satisfies: [placement.agent] });
  }

  const notExcludable = placements
    .filter((placement) => !targets.includes(placement.agent))
    .flatMap((placement) => {
      const via = chosen.find((write) => discovers(placement, write.dir));
      return via === undefined ? [] : [{ agent: placement.agent, via: via.dir }];
    });

  return { writes: chosen, notExcludable };
};
