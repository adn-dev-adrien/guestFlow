- **Reservations — a stay lasts at most 366 nights** (`specs/reservations-backend-mvc.md` rules 11-12).
  A departure typed far in the future (`9999-12-31`) made the price preview compute night by night for
  about 100 s and stalled every other request of the server. The quote, the reservation and the devis now
  refuse a stay longer than 366 nights at once (« Séjour trop long. »), the iCal import's own cap, and the
  fiche shows the message under the dates without asking for a quote.
