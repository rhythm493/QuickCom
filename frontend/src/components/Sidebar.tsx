import { Search, Map, BarChart3, Store } from 'lucide-react'

export type ViewType = 'search' | 'map' | 'analytics' | 'stores'

interface SidebarProps {
  activeView: ViewType
  onViewChange: (view: ViewType) => void
}

const NAV_ITEMS: { id: ViewType; icon: typeof Search; label: string }[] = [
  { id: 'search', icon: Search, label: 'Search' },
  { id: 'map', icon: Map, label: 'Map' },
  { id: 'analytics', icon: BarChart3, label: 'Analytics' },
  { id: 'stores', icon: Store, label: 'Stores' },
]

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  return (
    <aside className="w-16 md:w-20 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col items-center py-4 gap-1 shrink-0 transition-colors duration-200">
      {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
        const isActive = activeView === id
        return (
          <button
            key={id}
            onClick={() => onViewChange(id)}
            className={`w-12 h-12 md:w-14 md:h-14 flex flex-col items-center justify-center rounded-xl transition-all duration-200 group ${
              isActive
                ? 'bg-orange-500 text-white shadow-md'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
            title={label}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] mt-0.5 font-medium">{label}</span>
          </button>
        )
      })}
    </aside>
  )
}
