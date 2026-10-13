import { useMemo } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Avatar } from './Avatar'
import { IconActivity, IconContacts, IconGroups, IconHome, IconPlus, IconSearch, IconUser } from './icons'
import { useBalances, usePeople } from '../hooks/queries'
import { useUnreadCount } from '../hooks/useUnread'
import { useT } from '../lib/i18n'
import { formatINR } from '../lib/money'

const link = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors ${
    isActive
      ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
  }`

/** Laptop navigation: where you stand, the main action, and the sections. */
export function Sidebar() {
  const { t, lang, setLang } = useT()
  const navigate = useNavigate()
  const people = usePeople()
  const balances = useBalances()
  const unread = useUnreadCount()
  const me = people.me

  const { owed, owe } = useMemo(() => {
    let owed = 0
    let owe = 0
    for (const b of balances.data ?? []) {
      if (b.net > 0) owed += b.net
      else owe -= b.net
    }
    return { owed, owe }
  }, [balances.data])
  const net = owed - owe

  return (
    <aside
      aria-label={t('Sidebar')}
      className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-slate-200/80 bg-white px-4 py-6 lg:flex dark:border-slate-800 dark:bg-slate-900"
    >
      <NavLink to="/" className="flex items-center gap-2.5 px-2">
        <img src="./icon.svg" alt="" className="h-9 w-9 rounded-xl" />
        <span className="text-xl font-bold tracking-tight">Hisaab</span>
      </NavLink>

      <div className="mt-6 rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 p-4 text-white shadow-raised">
        <p className="text-xs font-medium text-brand-100">{t('Overall')}</p>
        <p className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums">
          {net === 0 ? t('All square') : `${net > 0 ? '+' : '−'}${formatINR(Math.abs(net))}`}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-white/10 px-2.5 py-2">
            <p className="text-brand-100">{t('You’ll get back')}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatINR(owed)}</p>
          </div>
          <div className="rounded-xl bg-white/10 px-2.5 py-2">
            <p className="text-brand-100">{t('You owe')}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">{formatINR(owe)}</p>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate('/add')}
        className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-700 font-semibold text-white shadow-sm transition-colors hover:bg-brand-800 dark:bg-brand-600 dark:hover:bg-brand-500"
      >
        <IconPlus size={20} /> {t('Add expense')}
      </button>

      <nav aria-label={t('Main')} className="mt-6 flex flex-col gap-1">
        <NavLink to="/" end className={link}><IconHome size={20} /> {t('Home')}</NavLink>
        <NavLink to="/friends" end className={link}><IconContacts size={20} /> {t('Friends')}</NavLink>
        <NavLink to="/groups" className={link}><IconGroups size={20} /> {t('Groups')}</NavLink>
        <NavLink to="/activity" className={link}>
          <IconActivity size={20} />
          <span className="flex-1">{t('Activity')}</span>
          {unread > 0 ? (
            <span className="rounded-full bg-red-600 px-1.5 text-[11px] leading-5 font-bold text-white" aria-label={t('{n} new', { n: unread })}>
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </NavLink>
        <NavLink to="/activity?search=1" className={() => link({ isActive: false })}><IconSearch size={20} /> {t('Search')}</NavLink>
        <NavLink to="/me" className={link}><IconUser size={20} /> {t('Me')}</NavLink>
      </nav>

      <div className="mt-auto space-y-3">
        <button
          type="button"
          onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}
          className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          {lang === 'hi' ? 'Switch to English' : 'Hinglish mein dekho'}
        </button>
        {me ? (
          <NavLink to="/me" className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60">
            <Avatar id={me.id} name={me.display_name} size={36} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{me.display_name}</span>
              <span className="block truncate text-xs text-slate-500">{me.upi_id ?? me.phone}</span>
            </span>
          </NavLink>
        ) : null}
      </div>
    </aside>
  )
}
