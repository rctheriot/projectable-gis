import { useEffect, useState } from 'react';
import { loadStoryIndex } from '@/story/loadStory';
import type { StorySummary } from '@/story/types';

interface Props {
  onOpen: (story: StorySummary) => void;
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
        <p className="landing__eyebrow">Projectable Pucks</p>
        <h1 className="landing__title">GIS Stories</h1>
        <p className="landing__lede">
          Pick a story to project onto the table. Turn the pucks to move through time, switch scenarios
          and bring layers in and out.
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
          <button key={story.id} type="button" className="story-card" onClick={() => onOpen(story)}>
            {story.coverImage ? <img className="story-card__image" src={story.coverImage} alt="" /> : null}
            <span className="story-card__body">
              <span className="story-card__title">{story.title}</span>
              {story.subtitle ? <span className="story-card__subtitle">{story.subtitle}</span> : null}
            </span>
          </button>
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
