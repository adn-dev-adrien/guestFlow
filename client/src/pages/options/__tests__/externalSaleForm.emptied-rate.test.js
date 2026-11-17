// specs/outside-booking-sas.md rule 11 (loop t2 UI2-8) — the external rate goes to the server only once typed: a rate typed then emptied is sent empty, so the server
// refuses it with the field named instead of the save keeping the old rate in silence; an untouched rate (null) is not sent.
import { externalSalePayload } from '../externalSaleForm';

test('an emptied rate is sent empty, a typed one as a number, an untouched one not at all', () => {
  expect(externalSalePayload({ sellableExternally: true, vatClass: 'drinks', externalVatRate: '' })).toEqual({ sellableExternally: true, vatClass: 'drinks', externalVatRate: '' });
  expect(externalSalePayload({ sellableExternally: true, vatClass: 'drinks', externalVatRate: ' 5,5 ' })).toEqual({ sellableExternally: true, vatClass: 'drinks', externalVatRate: 5.5 });
  expect(externalSalePayload({ sellableExternally: true, vatClass: '', externalVatRate: null })).toEqual({ sellableExternally: true });
});
