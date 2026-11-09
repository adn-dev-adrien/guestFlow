/** The « Maison » icon of a guest-app module (rule 11bis), for the studio's lists. */
import FenceIcon from '@mui/icons-material/Fence';
import WifiIcon from '@mui/icons-material/Wifi';
import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined';
import HotTubOutlinedIcon from '@mui/icons-material/HotTubOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined';

const ICONS = {
  gate: FenceIcon, wifi: WifiIcon, shop: ShoppingBagOutlinedIcon, bath: HotTubOutlinedIcon, soliomap: PlaceOutlinedIcon,
  booklet: MenuBookOutlinedIcon, orders: ReceiptLongOutlinedIcon, contacts: PhoneOutlinedIcon,
};

export default function ModuleIcon({ module }) {
  const Glyph = ICONS[module] || MenuBookOutlinedIcon;
  return <Glyph fontSize="small" />;
}
