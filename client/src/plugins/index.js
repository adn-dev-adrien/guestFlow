// The built-in plugin modules, client side (specs/plugins-phase-1-sdk.md rule 2). The only core file
// allowed to import a plugin folder; everything else goes through `sdk/`.
import weatherAlerts from './weather-alerts';
import schoolHolidays from './school-holidays';
import googleCalendar from './google-calendar';
import tariffRecipes from './tariff-recipes';
import gateAccess from './gate-access';
import accountingExport from './accounting-export';

const PLUGIN_MODULES = [weatherAlerts, schoolHolidays, googleCalendar, tariffRecipes, gateAccess, accountingExport];

export default PLUGIN_MODULES;
