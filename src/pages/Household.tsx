import { useNavigate, useParams } from 'react-router-dom'
import { Avatar, AvatarStack } from '../components/Avatar'
import { IconEdit, IconSwap } from '../components/icons'
import { BalanceLine, toneClass } from '../components/Money'
import { HeaderButton, Page } from '../components/Page'
import { ButtonLink, Card, ErrorView, LoadingView, Row, SectionTitle } from '../components/ui'
import { useBalances, useHouseholds, usePeople } from '../hooks/queries'
import { formatINR } from '../lib/money'
import { useT } from '../lib/i18n'

export function HouseholdPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { t } = useT()
  const people = usePeople()
  const balances = useBalances()
  const households = useHouseholds()

  if (households.isPending || people.isPending || balances.isPending) return <Page title="" back><LoadingView /></Page>
  const household = households.data?.find((h) => h.id === id)
  if (!household) return <Page title="" back="/"><ErrorView message={t('This pair was removed.')} /></Page>

  const members = household.memberIds.filter((m) => !people.byId.get(m)?.is_me)
  const net = members.reduce((s, m) => s + balances.net(m), 0)

  return (
    <Page
      title={household.name}
      back
      actions={
        <HeaderButton label={t('Edit pair')} onClick={() => navigate(`/pairs/${id}/edit`)}>
          <IconEdit />
        </HeaderButton>
      }
      footer={
        <div className="flex gap-3 pb-1">
          <ButtonLink to={`/add?household=${id}`} variant="secondary" className="flex-1">{t('Add expense')}</ButtonLink>
          <ButtonLink to={`/settle/household/${id}`} className="flex-1"><IconSwap size={18} /> {t('Settle together')}</ButtonLink>
        </div>
      }
    >
      <div className="flex flex-col items-center pt-2 text-center">
        <AvatarStack people={members.map((m) => ({ id: m, name: people.name(m) }))} size={72} />
        <p className={`mt-3 text-2xl font-bold ${toneClass(net)}`}>
          {net > 0 ? t('They owe you {amount}', { amount: formatINR(net) }) : net < 0 ? t('You owe them {amount}', { amount: formatINR(-net) }) : t('All square')}
        </p>
        <p className="mt-1 max-w-xs text-sm text-slate-500 dark:text-slate-400">
          {t('Combined balance. Either of them can settle for both — Hisaab keeps track of what they owe each other.')}
        </p>
      </div>

      <SectionTitle>{t('Members')}</SectionTitle>
      <Card className="divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
        {members.map((m) => (
          <Row
            key={m}
            to={`/p/${m}`}
            leading={<Avatar id={m} name={people.name(m)} />}
            title={people.name(m)}
            trailing={<BalanceLine net={balances.net(m)} they={t('owes you')} you={t('you owe')} />}
            chevron={false}
          />
        ))}
      </Card>
    </Page>
  )
}
