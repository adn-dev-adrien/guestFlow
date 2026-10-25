// The built-in plugin modules, client side (specs/plugin-engine-backport.md rule 1). The only core file
// allowed to import a plugin folder; everything else goes through `sdk/`.
import gitesDeFranceIntake from './gites-de-france-intake';
import bookingIntake from './booking-intake';
import airbnbIntake from './airbnb-intake';

const PLUGIN_MODULES = [gitesDeFranceIntake, bookingIntake, airbnbIntake];

export default PLUGIN_MODULES;
