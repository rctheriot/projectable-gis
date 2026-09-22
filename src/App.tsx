import { useEffect, useState } from 'react';
import { useStore } from '@/state/useStore';
import type { SourceKind } from '@/pucks/usePucks';
import { Landing } from '@/ui/Landing';
import { TableView } from '@/ui/TableView';

/**
 * Puck input is chosen at runtime so the same build runs on a desk and on the rig:
 *   ?pucks=keyboard                      (default)
 *   ?pucks=websocket&tracker=ws://host:port
 */
function readSourceConfig(): { kind: SourceKind; websocketUrl: string } {
  const params = new URLSearchParams(window.location.search);
  const kind = params.get('pucks') === 'websocket' ? 'websocket' : 'keyboard';
  return { kind, websocketUrl: params.get('tracker') ?? 'ws://localhost:8765' };
}

export function App() {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const loaded = useStore((s) => s.loaded);
  const openStory = useStore((s) => s.openStory);
  const closeStory = useStore((s) => s.closeStory);

  const [config] = useState(readSourceConfig);

  // A single-story deployment can skip the picker with ?story=<id>.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('story');
    if (id && status === 'idle') void openStory(`stories/${id}/story.json`);
  }, [status, openStory]);

  if (status === 'loading') {
    return (
      <main className="boot">
        <p className="boot__message">Loading story&hellip;</p>
      </main>
    );
  }

  if (status === 'ready' && loaded) {
    return (
      <TableView
        loaded={loaded}
        sourceKind={config.kind}
        websocketUrl={config.websocketUrl}
        onClose={closeStory}
      />
    );
  }

  return <Landing error={error} onOpen={(story) => void openStory(story.path)} />;
}
