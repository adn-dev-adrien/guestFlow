/**
 * Icon — the app's one line set (specs/guest-app/guest-app.md §6.3: Lucide, 1.75 px stroke, rounded caps), by name.
 *
 * Props: `name` (a key of ICONS), `className`. Always decorative (`aria-hidden`): the control around it
 * carries the label.
 */
import {
  ArrowDown, ArrowLeft, ArrowUp, ArrowUpRight, Bath, BookOpen, Check, ChevronDown, ChevronRight, Clock, CloudOff, CloudRain, Copy,
  CreditCard, Droplet, Fence, Gift, House, Info, Lightbulb, LocateFixed, Mail, MapPin, MessageCircle, Minus, Moon, Navigation, Phone, Plus, QrCode,
  ReceiptText, Search, Share, ShoppingBag, Store, Sun, Thermometer, Trash2, TriangleAlert, Wifi, WifiOff, Wind, X, Zap,
} from 'lucide-react';

export const ICONS = Object.freeze({
  home: House,
  booklet: BookOpen,
  shop: ShoppingBag,
  orders: ReceiptText,
  gate: Fence,
  wifi: Wifi,
  wifiOff: WifiOff,
  bath: Bath,
  soliomap: MapPin,
  places: Store,
  contacts: Phone,
  ext: ArrowUpRight,
  sun: Sun,
  moon: Moon,
  back: ArrowLeft,
  chev: ChevronRight,
  chevDown: ChevronDown,
  plus: Plus,
  minus: Minus,
  trash: Trash2,
  x: X,
  search: Search,
  check: Check,
  clock: Clock,
  info: Info,
  alert: TriangleAlert,
  cloudoff: CloudOff,
  gift: Gift,
  card: CreditCard,
  copy: Copy,
  phone: Phone,
  chat: MessageCircle,
  mail: Mail,
  pin: MapPin,
  share: Share,
  qr: QrCode,
  // specs/guest-app/guest-app-local-amenities.md — the « Pratique » map's controls and its « Itinéraire ».
  locate: LocateFixed,
  nav: Navigation,
  // specs/guest-app/guest-app-home-automation.md — the « Domotique » page.
  smartHome: Thermometer,
  light: Lightbulb,
  rain: CloudRain,
  power: Zap,
  humidity: Droplet,
  wind: Wind,
  gridOut: ArrowUp,
  gridIn: ArrowDown,
});

export default function Icon({ name, className }) {
  const Glyph = ICONS[name] || Info;
  return <Glyph className={className} strokeWidth={1.75} absoluteStrokeWidth={false} aria-hidden="true" focusable="false" />;
}
