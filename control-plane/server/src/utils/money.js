/** Euro amounts are cents everywhere; this is the one place they become text. */

const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

const euros = (cents) => fmt.format(cents / 100).replace(/ /g, ' ');

module.exports = { euros };
