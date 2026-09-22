import { useEffect, useState } from 'react';
import { loadStoryIndex } from '@/story/loadStory';
import type { StorySummary } from '@/story/types';

export type LaunchMode = 'explore' | 'table';

interface Props {
  onOpen: (story: StorySummary, mode: LaunchMode) => void;
  error: string | null;
}

/** Story picker. New stories appear here automatically from stories/index.json. */
export function Landing({ onOpen, error }: Props) {
  const [stories, setStories] = useState<StorySummary[] | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);

  useEffect(() => {
    loadStoryIndex()
      .then(setStories)
      .catch((e: unknown) => setIndexError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main className="landing">
      <header className="landing__header">
        <p className="landing__eyebrow">Projectable</p>
        <h1 className="landing__title">GIS Stories</h1>
        <p className="landing__lede">
          Each story can be explored here in the browser, or projected onto the table and driven with
          physical pucks.
        </p>
      </header>

      {error ? <p className="landing__error">{error}</p> : null}
      {indexError ? (
        <p className="landing__error">
          Could not read the story index: {indexError}. Run <code>npm run prepare-story</code> first.
        </p>
      ) : null}

      <div className="landing__grid">
        {stories?.map((story) => (
          <article key={story.id} className="story-card">
            {story.coverImage ? <img className="story-card__image" src={story.coverImage} alt="" /> : null}
            <div className="story-card__body">
              <h2 className="story-card__title">{story.title}</h2>
              {story.subtitle ? <p className="story-card__subtitle">{story.subtitle}</p> : null}

              <div className="story-card__actions">
                {/* Explore is first and primary: most people opening this link have no table. */}
                <button type="button" className="button button--primary" onClick={() => onOpen(story, 'explore')}>
                  Explore
                </button>
                <button type="button" className="button" onClick={() => onOpen(story, 'table')}>
                  Projection table
                </button>
              </div>
            </div>
          </article>
        ))}
        {stories?.length === 0 ? (
          <p className="landing__error">
            No stories built yet. Run <code>npm run prepare-story</code>.
          </p>
        ) : null}
      </div>
    </main>
  );
}
