/**
 * Icon — the app's one line set (specs/guest-app.md §6.3: Lucide, 1.75 px stroke, rounded caps), by name.
 *
 * Props: `name` (a key of ICONS), `className`. Always decorative (`aria-hidden`): the control around it
 * carries the label.
 */
import {
  ArrowLeft, ArrowUpRight, Bath, BookOpen, Check, ChevronRight, Clock, CloudOff, Copy, CreditCard, Fence, Gift, House,
  Info, Mail, MapPin, MessageCircle, Minus, Moon, Phone, Plus, QrCode, ReceiptText, Search, Share, ShoppingBag, Sun,
  Trash2, TriangleAlert, Wifi, WifiOff, X,
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
  contacts: Phone,
  ext: ArrowUpRight,
  sun: Sun,
  moon: Moon,
  back: ArrowLeft,
  chev: ChevronRight,
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
});

export default function Icon({ name, className }) {
  const Glyph = ICONS[name] || Info;
  return <Glyph className={className} strokeWidth={1.75} absoluteStrokeWidth={false} aria-hidden="true" focusable="false" />;
}
