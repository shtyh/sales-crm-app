import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'

type Tile = {
  title: string
  subtitle: string
  icon: string
  to?: string
}

// Six-tile main menu mirroring the workshop-management-system layout the
// team is used to. Tiles without a `to` are placeholders — they render
// disabled with a "Coming soon" hint until the matching screen ships.
const TILES: Tile[] = [
  {
    title: 'Job Sheet / Billing',
    subtitle: 'Active orders, technician load, day-end revenue',
    icon: '📋',
    to: '/service/ops',
  },
  {
    title: 'Payment / Receipt',
    subtitle: 'Collect customer payments and print receipts',
    icon: '🧾',
  },
  {
    title: 'Housekeeping',
    subtitle: 'Vehicle registry intake and customer records',
    icon: '🧹',
    to: '/vehicles',
  },
  {
    title: 'Stock Control',
    subtitle: 'Parts inventory, reorder levels, consumption',
    icon: '📦',
  },
  {
    title: 'Inquiry',
    subtitle: 'Search vehicles, jobs, and customers',
    icon: '🔍',
  },
  {
    title: 'Reporting',
    subtitle: 'Daily / monthly performance + commission rollups',
    icon: '📊',
  },
]

/**
 * Workshop landing page. Replaces the old data-dense dashboard with a
 * tile menu — same style as the legacy WMS system the team is used to,
 * so workshop roles have a single click between Home and the area they
 * want. The detailed operations view moves to /service/ops and is what
 * Job Sheet / Billing links to.
 */
export function ServiceDashboardPage() {
  return (
    <AppShell>
      <div className="-mt-6 mb-6 -mx-4 sm:-mx-6">
        <div className="bg-gradient-to-r from-slate-700 to-slate-500 px-4 py-5 text-white sm:px-6 sm:py-6">
          <div className="text-[10px] font-medium uppercase tracking-widest text-slate-200">
            SWL Motors SDN BHD
          </div>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
            Workshop Management System
          </h1>
          <p className="mt-1 text-sm text-slate-200">
            Pick an area to get started.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((t) => (
          <TileCard key={t.title} tile={t} />
        ))}
      </div>
    </AppShell>
  )
}

function TileCard({ tile }: { tile: Tile }) {
  const body = (
    <div
      className={`group flex h-full flex-col rounded-2xl border bg-white p-5 transition ${
        tile.to
          ? 'border-gray-200 shadow-sm hover:-translate-y-0.5 hover:border-gray-900 hover:shadow-md'
          : 'border-dashed border-gray-200 opacity-70'
      }`}
    >
      <div className="flex items-start justify-between">
        <span className="text-3xl">{tile.icon}</span>
        {!tile.to && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Coming soon
          </span>
        )}
      </div>
      <div className="mt-4 text-base font-semibold text-gray-900">
        {tile.title}
      </div>
      <div className="mt-1 text-xs text-gray-500">{tile.subtitle}</div>
      {tile.to && (
        <div className="mt-4 text-xs font-medium text-gray-900 opacity-0 transition group-hover:opacity-100">
          Open →
        </div>
      )}
    </div>
  )
  return tile.to ? (
    <Link to={tile.to} className="block">
      {body}
    </Link>
  ) : (
    <div aria-disabled="true">{body}</div>
  )
}
