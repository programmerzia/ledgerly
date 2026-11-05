import {
  LayoutDashboard, FileSpreadsheet, CreditCard, BookMarked, BarChart3, CheckSquare, Settings,
  Building, ShieldCheck, Package, Layers, Coins, FileText, Calendar, History, RefreshCw, Upload, ClipboardList,
  Repeat, Wand2, Percent, ShoppingCart, PackageCheck, Circle,
} from 'lucide-react';
import type { NavIcon } from './nav';

/** Icon keys the menu API sends (database/seeders/menu_items.php) and the component each draws. */
const ICONS: Record<string, NavIcon> = {
  'layout-dashboard': LayoutDashboard,
  'check-square': CheckSquare,
  'file-spreadsheet': FileSpreadsheet,
  repeat: Repeat,
  building: Building,
  package: Package,
  'clipboard-list': ClipboardList,
  'shopping-cart': ShoppingCart,
  'package-check': PackageCheck,
  'file-text': FileText,
  coins: Coins,
  'shield-check': ShieldCheck,
  'bar-chart': BarChart3,
  'credit-card': CreditCard,
  wand: Wand2,
  'book-marked': BookMarked,
  'refresh-cw': RefreshCw,
  layers: Layers,
  calendar: Calendar,
  percent: Percent,
  settings: Settings,
  upload: Upload,
  history: History,
};

/** An unknown key draws a plain dot, so a new menu row never breaks the sidebar before the SPA learns its icon. */
export const navIcon = (key: string): NavIcon => ICONS[key] ?? Circle;
