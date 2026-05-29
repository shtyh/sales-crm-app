import { Navigate } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'

// ─── Inquiry Hub ────────────────────────────────────────────────────────────
//
// Port of the legacy WMS Inquiry Form. Tile menu split into three sections.
// Some tiles point at full pages we already have (Closing Stock, Parts
// List, Job Sheet / Billing screen), others go to new directory pages
// built in this batch (suppliers, stock-purchase history). The rest carry
// "Coming soon" pills until the supporting data lands.

type Tile = {
  title: string
  subtitle: string
  icon: string
  to?: string
  badge?: 'Coming soon'
}

type Section = {
  heading: string
  tiles: Tile[]
}

const SECTIONS: Section[] = [
  {
    heading: 'Transaction Inquiry',
    tiles: [
      {
        title: 'Job Sheet / Billing History',
        subtitle: 'Search jobs by no, vehicle, customer',
        icon: '📋',
        to: '/service/ops',
      },
      {
        title: 'Outstanding Payment',
        subtitle: 'Jobs not yet collected · O/S amount',
        icon: '💰',
        to: '/service/ops',
      },
      {
        title: 'Stock On Hand',
        subtitle: 'Closing stock by group, qty + value',
        icon: '📦',
        to: '/service/stock/closing',
      },
      {
        title: 'Stock Purchase History',
        subtitle: 'Past stock-received receipts',
        icon: '📥',
        to: '/service/inquiry/receipts',
      },
      {
        title: 'Stock Selling History',
        subtitle: 'Per-part issued history',
        icon: '📤',
        badge: 'Coming soon',
      },
      {
        title: 'Bank Cheque History',
        subtitle: 'Cheque-payment audit trail',
        icon: '🏦',
        badge: 'Coming soon',
      },
      {
        title: 'Other Payment Type History',
        subtitle: 'Non-cash receipt log',
        icon: '💳',
        badge: 'Coming soon',
      },
    ],
  },
  {
    heading: 'System Setup',
    tiles: [
      {
        title: 'Client Account Master',
        subtitle:
          'Service customers — auto-cloned on delivery + manual entry',
        icon: '👤',
        to: '/service/customers',
      },
      {
        title: 'Client Vehicle',
        subtitle: 'Vehicles + owner + chassis lookup',
        icon: '🚗',
        to: '/vehicles',
      },
      {
        title: 'Vehicle Type',
        subtitle: 'Proton model master · 86 variants',
        icon: '🏷️',
        to: '/service/inquiry/vehicle-types',
      },
      {
        title: 'Vendor / Supplier',
        subtitle: 'Supplier master · address, contact, SST',
        icon: '🏭',
        to: '/service/inquiry/suppliers',
      },
      {
        title: 'Service Advisor',
        subtitle: 'SA staff directory',
        icon: '🧑‍💼',
        badge: 'Coming soon',
      },
      {
        title: 'Mechanic',
        subtitle: 'Technician directory + specialty',
        icon: '🔧',
        badge: 'Coming soon',
      },
      {
        title: 'Profit Center',
        subtitle: 'Cost-center breakdown',
        icon: '🏢',
        badge: 'Coming soon',
      },
      {
        title: 'Company Profile',
        subtitle: 'SWL Motors profile + addresses',
        icon: '📜',
        badge: 'Coming soon',
      },
    ],
  },
  {
    heading: 'Products & Services',
    tiles: [
      {
        title: 'Parts',
        subtitle: 'Inventory master · 1,580 parts',
        icon: '⚙️',
        to: '/service/stock/parts',
      },
      {
        title: 'Lubricants',
        subtitle: 'Oils, coolants, brake fluid (OIL category)',
        icon: '🛢️',
        to: '/service/stock/parts?category=OIL',
      },
      {
        title: 'Services',
        subtitle: 'Service-type catalogue',
        icon: '🛠️',
        badge: 'Coming soon',
      },
    ],
  },
]

export function InquiryHubPage() {
  const { canAccessService } = useAuth()
  if (canAccessService === false) return <Navigate to="/" replace />

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="-mt-6 -mx-4 sm:-mx-6">
          <div className="bg-gradient-to-r from-slate-700 to-slate-500 px-4 py-5 text-white sm:px-6 sm:py-6">
            <div className="text-[10px] font-medium uppercase tracking-widest text-slate-200">
              Workshop Management System
            </div>
            <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
              Inquiry
            </h1>
            <p className="mt-1 text-sm text-slate-200">
              Quick lookups across the workshop — jobs, parts, customers,
              suppliers.
            </p>
          </div>
        </div>

        {SECTIONS.map((section) => (
          <section key={section.heading} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              {section.heading}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {section.tiles.map((t) =>
                t.to ? (
                  <Link
                    key={t.title}
                    to={t.to}
                    className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-gray-300 hover:shadow"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{t.icon}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 group-hover:text-black">
                          {t.title}
                        </div>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {t.subtitle}
                        </p>
                      </div>
                    </div>
                  </Link>
                ) : (
                  <div
                    key={t.title}
                    className="rounded-xl border border-dashed border-gray-300 bg-gray-50/60 p-4"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl opacity-50">{t.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-gray-600">
                            {t.title}
                          </div>
                          <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-600">
                            {t.badge}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-gray-400">
                          {t.subtitle}
                        </p>
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  )
}
