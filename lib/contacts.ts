/**
 * The Send panel's address book: names for Terra addresses, with the memo an
 * exchange deposit needs, and the addresses sent to lately. Kept in this
 * browser only (localStorage); nothing about them leaves the device.
 */

import { useEffect, useState } from 'react'

const CONTACTS_KEY = 'terraswap_contacts'
const RECENT_KEY = 'terraswap_recent_recipients'
const EVENT = 'terra:contacts'
const MAX_CONTACTS = 50
const MAX_RECENT = 6

export interface Contact {
  address: string
  name: string
  /** sent with every transfer to this address, for exchanges that ask for one */
  memo?: string
  added: number
}

function read(k: string): unknown {
  try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null }
}
function write(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); window.dispatchEvent(new CustomEvent(EVENT)) } catch { /* private mode: nothing is kept */ }
}

export function readContacts(): Contact[] {
  const v = read(CONTACTS_KEY)
  return Array.isArray(v)
    ? v.filter((c): c is Contact => !!c && typeof c === 'object' && typeof (c as Contact).address === 'string' && typeof (c as Contact).name === 'string')
    : []
}

/** Adds a contact, or renames the one already saved for that address. */
export function saveContact(c: { address: string; name: string; memo?: string }) {
  const name = c.name.trim().slice(0, 32)
  if (!name) return
  const memo = c.memo?.trim().slice(0, 256) || undefined
  const rest = readContacts().filter(x => x.address !== c.address)
  write(CONTACTS_KEY, [{ address: c.address, name, memo, added: Date.now() }, ...rest].slice(0, MAX_CONTACTS))
}

export function removeContact(address: string) {
  write(CONTACTS_KEY, readContacts().filter(c => c.address !== address))
}

export function readRecentRecipients(): string[] {
  const v = read(RECENT_KEY)
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function rememberRecipient(address: string) {
  write(RECENT_KEY, [address, ...readRecentRecipients().filter(a => a !== address)].slice(0, MAX_RECENT))
}

/** Contacts and recent recipients, re-read when they change in this tab or another. Empty until mounted. */
export function useContacts(): { contacts: Contact[]; recent: string[] } {
  const [n, bump] = useState(0)
  useEffect(() => {
    const f = () => bump(x => x + 1)
    f()
    window.addEventListener(EVENT, f)
    window.addEventListener('storage', f)
    return () => { window.removeEventListener(EVENT, f); window.removeEventListener('storage', f) }
  }, [])
  return n === 0 ? { contacts: [], recent: [] } : { contacts: readContacts(), recent: readRecentRecipients() }
}
