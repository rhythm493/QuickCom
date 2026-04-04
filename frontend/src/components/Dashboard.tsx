import { useState, type ReactNode } from 'react'
import { Sidebar, type ViewType } from './Sidebar'

interface DashboardProps {
  searchView: ReactNode
  mapView: ReactNode
  analyticsView: ReactNode
  storesView: ReactNode
}

export function Dashboard({ searchView, mapView, analyticsView, storesView }: DashboardProps) {
  const [activeView, setActiveView] = useState<ViewType>('search')

  const viewContent: Record<ViewType, ReactNode> = {
    search: searchView,
    map: mapView,
    analytics: analyticsView,
    stores: storesView,
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <Sidebar activeView={activeView} onViewChange={setActiveView} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        {viewContent[activeView]}
      </main>
    </div>
  )
}
