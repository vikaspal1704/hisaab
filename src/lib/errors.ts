import { currentLang, translate } from './i18n'

const MESSAGES: Record<string, string> = {
  profile_required: 'Finish setting up your profile first.',
  phone_taken: 'This number is already linked to another account.',
  phone_mismatch: 'Use the same number you signed in with.',
  cannot_add_self: 'That’s your own number.',
  unknown_person: 'Add this person as a friend first.',
  split_mismatch: 'The split doesn’t add up to the total.',
  nothing_to_split: 'Nobody owes anybody here — add someone else.',
  must_participate: 'You can only add entries you are part of.',
  not_group_member: 'Everyone must be in the group.',
  group_not_found: 'Group not found.',
  entry_not_found: 'This entry no longer exists.',
  entry_deleted: 'This entry was deleted.',
  stale_entry: 'Someone changed this entry while you were editing. Reload and try again.',
  invalid_payment: 'Pick two different people.',
  allocation_mismatch: 'This payment doesn’t balance. Try again.',
  household_size: 'A pair needs 2 to 6 people.',
  already_in_household: 'Someone here is already in another pair.',
  household_not_found: 'Pair not found.',
  too_many_contacts: 'You can import up to 500 contacts at a time.',
  forgive_too_much: 'You can only let go of what they owe you.',
  link_not_found: 'This link isn’t active any more.',
  no_kitty: 'Start a kitty for this group first.',
  holder_cannot_contribute: 'The kitty holder doesn’t need to add money in.',
  kitty_payer: 'Kitty expenses are paid by the kitty holder.',
  recurring_not_found: 'That monthly bill no longer exists.',
  contacts_style: 'Pick baari or exact.',
  people_phone_format: 'That phone number doesn’t look right.',
  people_upi_format: 'That UPI ID doesn’t look right (e.g. name@okaxis).',
  people_name_length: 'Name must be 1–60 characters.',
  entries_description_length: 'Description must be 1–100 characters.',
  entries_amount_range: 'Amount must be between ₹0.01 and ₹1 crore.',
}

/** A validation problem whose message is already written for the person using the app. */
export class InputError extends Error {}

/** Turns a Supabase/Postgres error into something a person can act on. */
export function friendlyError(error: unknown): string {
  if (error instanceof InputError) return error.message
  return translate(currentLang(), englishError(error))
}

function englishError(error: unknown): string {
  const text =
    error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : String(error)
  for (const [code, message] of Object.entries(MESSAGES)) if (text.includes(code)) return message
  if (/fetch|network/i.test(text)) return 'No connection. Check your internet and try again.'
  return 'Something went wrong. Please try again.'
}
