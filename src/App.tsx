import { useEffect, useState } from 'react';
import { useStore } from '@/state/useStore';
import type { SourceKind } from '@/pucks/usePucks';
import { ExploreView } from '@/ui/ExploreView';
import { Landing, type LaunchMode } from '@/ui/Landing';
import { TableView } from '@/ui/TableView';

/**
 * Puck input is chosen at runtime so the same build runs on a desk and on the rig:
 *   ?pucks=keyboard                      (default; arrows and WASD, for development)
 *   ?pucks=camera                        (the webcam under the table)
 *   ?pucks=websocket&tracker=ws://host:port
 */
function readSourceConfig(): { kind: SourceKind; websocketUrl: string } {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('pucks');
  const kind: SourceKind =
    requested === 'camera' || requested === 'websocket' ? requested : 'keyboard';
  return { kind, websocketUrl: params.get('tracker') ?? 'ws://localhost:8765' };
}

/**
 * `table` is opt-in. A link shared with someone who has no projection table should
 * open something they can actually use.
 */
function readMode(): LaunchMode {
  return new URLSearchParams(window.location.search).get('mode') === 'table' ? 'table' : 'explore';
}

/** Keeps the address bar shareable: the URL always describes what is on screen. */
function writeUrl(storyId: string | null, mode: LaunchMode) {
  const url = new URL(window.location.href);
  if (storyId) {
    url.searchParams.set('story', storyId);
    url.searchParams.set('mode', mode);
  } else {
    url.searchParams.delete('story');
    url.searchParams.delete('mode');
  }
  window.history.replaceState(null, '', url);
}

export function App() {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const loaded = useStore((s) => s.loaded);
  const openStory = useStore((s) => s.openStory);
  const closeStory = useStore((s) => s.closeStory);

  const [config] = useState(readSourceConfig);
  const [mode, setMode] = useState<LaunchMode>(readMode);

  // Deep links open a story directly: ?story=<id>&mode=table|explore
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('story');
    if (id && status === 'idle') void openStory(`stories/${id}/story.json`);
  }, [status, openStory]);

  const open = (storyId: string, path: string, next: LaunchMode) => {
    setMode(next);
    writeUrl(storyId, next);
    void openStory(path);
  };

  const close = () => {
    writeUrl(null, mode);
    closeStory();
  };

  if (status === 'loading') {
    return (
      <main className="boot">
        <p className="boot__message">Loading story&hellip;</p>
      </main>
    );
  }

  if (status === 'ready' && loaded) {
    return mode === 'table' ? (
      <TableView
        loaded={loaded}
        sourceKind={config.kind}
        websocketUrl={config.websocketUrl}
        onClose={close}
      />
    ) : (
      <ExploreView loaded={loaded} onClose={close} />
    );
  }

  return <Landing error={error} onOpen={(story, next) => open(story.id, story.path, next)} />;
}
