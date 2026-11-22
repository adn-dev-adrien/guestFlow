/**
 * GiftVoucherTabs — the three views of the plugin (« Bons », « Campagnes », « Visuels »), drawn in the page bar's `tabs` slot.
 *
 * Props: value ('vouchers' | 'campaigns' | 'visuals')
 */
import React from 'react';
import { useNavigate } from 'react-router';
import { PageTabs } from '../sdk';

const ITEMS = [{ value: 'vouchers', label: 'Bons' }, { value: 'campaigns', label: 'Campagnes' }, { value: 'visuals', label: 'Visuels' }];
const PATHS = { vouchers: '/bons-cadeaux', campaigns: '/bons-cadeaux/campagnes', visuals: '/bons-cadeaux/visuels' };

export default function GiftVoucherTabs({ value }) {
  const navigate = useNavigate();
  return <PageTabs value={value} onChange={(next) => navigate(PATHS[next])} items={ITEMS} ariaLabel="Bons cadeaux" />;
}
