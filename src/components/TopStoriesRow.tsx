import type { TopStory } from '@/lib/types'

interface TopStoriesRowProps {
  stories: TopStory[]
}

export default function TopStoriesRow({ stories }: TopStoriesRowProps) {
  if (!stories || stories.length === 0) return null

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-3 md:overflow-visible">
      {stories.slice(0, 3).map((story, i) => (
        <a
          key={i}
          href={story.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group min-w-[260px] flex-shrink-0 overflow-hidden rounded-xl border border-surface-border bg-surface-card transition-colors hover:border-gray-600 md:min-w-0"
        >
          {/* Image */}
          <div className="relative h-36 overflow-hidden bg-gray-800">
            {story.image ? (
              <img
                src={story.image}
                alt={story.headline}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-gray-700 to-gray-800" />
            )}
          </div>

          {/* Content */}
          <div className="p-3">
            {story.source && (
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="text-xs font-medium text-gray-400">{story.source}</span>
              </div>
            )}
            <h3 className="text-sm font-semibold leading-snug text-white group-hover:text-gray-200 line-clamp-3">
              {story.headline}
            </h3>
            <p className="mt-1 text-xs text-gray-500">Today</p>
          </div>
        </a>
      ))}
    </div>
  )
}
