import { NavLink, useNavigate } from 'react-router-dom'
import { useUnreadCount } from '../hooks/useUnread'
import { useT } from '../lib/i18n'
import { IconActivity, IconGroups, IconHome, IconPlus, IconUser } from './icons'

const item = ({ isActive }: { isActive: boolean }) =>
  `flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium ${
    isActive ? 'text-brand-700 dark:text-brand-500' : 'text-slate-500 dark:text-slate-400'
  }`

export function BottomNav() {
  const navigate = useNavigate()
  const { t } = useT()
  const unread = useUnreadCount()
  return (
    <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="mx-auto flex max-w-lg items-end px-2 pt-1">
        <NavLink to="/" end className={item}><IconHome />{t('Home')}</NavLink>
        <NavLink to="/groups" className={item}><IconGroups />{t('Groups')}</NavLink>
        <div className="flex flex-1 justify-center">
          <button
            type="button"
            onClick={() => navigate('/add')}
            aria-label={t('Add expense')}
            className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg shadow-brand-700/30 active:bg-brand-800"
          >
            <IconPlus size={28} />
          </button>
        </div>
        <NavLink to="/activity" className={item}>
          <span className="relative">
            <IconActivity />
            {unread > 0 ? (
              <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-red-600 px-1 text-[10px] leading-4 font-bold text-white" aria-label={t('{n} new', { n: unread })}>
                {unread > 9 ? '9+' : unread}
              </span>
            ) : null}
          </span>
          {t('Activity')}
        </NavLink>
        <NavLink to="/me" className={item}><IconUser />{t('Me')}</NavLink>
      </div>
    </nav>
  )
}
