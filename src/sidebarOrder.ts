export type SidebarOrderSnapshot = {
  projectPaths: string[];
  chatIdsByProject: Record<string, string[]>;
};

type SidebarChat = {
  id: string;
};

type SidebarProject<TChat extends SidebarChat> = {
  projectPath: string;
  chats: TChat[];
};

export function captureSidebarOrder<TChat extends SidebarChat, TProject extends SidebarProject<TChat>>(
  projects: TProject[]
): SidebarOrderSnapshot {
  return {
    projectPaths: projects.map((project) => project.projectPath),
    chatIdsByProject: Object.fromEntries(
      projects.map((project) => [project.projectPath, project.chats.map((chat) => chat.id)])
    )
  };
}

function preserveKnownOrder<T>(items: T[], keys: string[], keyForItem: (item: T) => string) {
  const rankByKey = new Map(keys.map((key, index) => [key, index]));

  return items
    .map((item, sourceIndex) => ({ item, sourceIndex, rank: rankByKey.get(keyForItem(item)) }))
    .sort((left, right) => {
      if (left.rank !== undefined && right.rank !== undefined) {
        return left.rank - right.rank;
      }

      if (left.rank !== undefined) {
        return -1;
      }

      if (right.rank !== undefined) {
        return 1;
      }

      return left.sourceIndex - right.sourceIndex;
    })
    .map(({ item }) => item);
}

export function applySidebarOrder<TChat extends SidebarChat, TProject extends SidebarProject<TChat>>(
  projects: TProject[],
  snapshot: SidebarOrderSnapshot
): TProject[] {
  return preserveKnownOrder(projects, snapshot.projectPaths, (project) => project.projectPath).map((project) => ({
    ...project,
    chats: preserveKnownOrder(project.chats, snapshot.chatIdsByProject[project.projectPath] ?? [], (chat) => chat.id)
  }));
}

export function nextProjectCollapseState(current: Set<string>, projectPaths: string[]): Set<string> {
  const allCollapsed = projectPaths.length > 0 && projectPaths.every((projectPath) => current.has(projectPath));
  const next = new Set(current);

  for (const projectPath of projectPaths) {
    if (allCollapsed) {
      next.delete(projectPath);
    } else {
      next.add(projectPath);
    }
  }

  return next;
}
