export type UserRole = 'admin' | 'manager' | 'cashier' | 'waiter' | 'kitchen' | 'staff';

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  pin?: string;
  active: boolean;
  avatarUrl?: string;
}

export interface BusinessSettings {
  restaurantName: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  fssai: string;
  logoUrl: string;
  cgstPercent: number; // e.g. 2.5
  sgstPercent: number; // e.g. 2.5
  serviceChargePercent: number; // e.g. 0
  serviceChargeEnabled: boolean;
  roundOff: boolean;
  billHeader: string;
  billFooter: string;
  printerWidth: string; // '80mm'
  isDemoDataActive?: boolean;
  rolePermissions?: Record<string, Record<string, boolean>>;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
}

export type TableSection = 'AC Grand Hall' | 'Royal Family Suite' | 'Garden Patio' | (string & {});
export type TableStatus = 'vacant' | 'occupied' | 'bill_printed' | 'reserved';
export type KitchenStage = 'pending' | 'accepted' | 'ready' | 'served';

export interface RestaurantTable {
  id: string;
  tableNumber: string; // e.g. 'T-01', 'F-01', 'G-01'
  section: TableSection;
  capacity: number;
  status: TableStatus;
  currentOrderId?: string;
  assignedSteward?: string;
  guestCount?: number;
  totalPaise?: number;
  lastUpdated: string;
  kitchenStage?: KitchenStage;
}

export type VegType = 'veg' | 'non-veg' | 'egg';

export interface MenuCategory {
  id: string;
  name: string;
  icon: string;
  sortOrder: number;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  pricePaise: number; // in paise (e.g. 38000 = ₹380.00)
  vegType: VegType;
  gstPercent: number; // usually 5
  isAvailable: boolean;
  preparationTimeMins: number;
  isBestseller?: boolean;
  salesCount?: number;
  imageUrl?: string;
  demoFlag?: boolean;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  pricePaise: number;
  quantity: number;
  notes?: string;
  kotStatus: 'sent' | 'cooking' | 'served';
  kotTime: string;
}

export type OrderStatus = 'open' | 'sent_to_kitchen' | 'preparing' | 'ready_for_pickup' | 'served' | 'billed' | 'settled' | 'cancelled';

export interface Order {
  id: string;
  tableId: string;
  tableNumber: string;
  orderNumber: string;
  stewardName: string;
  guestCount: number;
  items: OrderItem[];
  status: OrderStatus;
  kitchenStage?: KitchenStage;
  kitchenAcceptedAt?: string;
  kitchenReadyAt?: string;
  createdAt: string;
  updatedAt: string;
  demoFlag?: boolean;
}

export interface BillItemSnapshot {
  menuItemId: string;
  name: string;
  pricePaise: number;
  quantity: number;
  totalPaise: number;
  gstPercent: number;
}

export interface Bill {
  id: string;
  billNumber: string; // e.g. UFP-2025-1042
  orderId: string;
  tableId: string;
  tableNumber: string;
  guestCount: number;
  stewardName: string;
  items: BillItemSnapshot[];
  subtotalPaise: number;
  discountPercent: number;
  discountPaise: number;
  discountReason?: string;
  discountApprovedBy?: string;
  serviceChargePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  paymentStatus: 'unpaid' | 'paid' | 'cancelled';
  cancellationReason?: string;
  paymentMode?: 'cash' | 'upi' | 'card' | 'split';
  paymentDetails?: {
    cashPaise?: number;
    upiPaise?: number;
    cardPaise?: number;
    upiRef?: string;
    cardLast4?: string;
  };
  createdAt: string;
  settledAt?: string;
  demoFlag?: boolean;
}

export interface Staff {
  id: string;
  employeeCode: string; // e.g. UFP-EMP-01
  fullName: string;
  role: string;
  department: 'Management' | 'Service' | 'Kitchen' | 'Inventory / Accounts';
  phone: string;
  email: string;
  aadhaarNumber: string; // sensitive
  familyDetails: string;
  currentAddress: string;
  permanentAddress: string;
  dateOfJoining: string;
  salaryType: 'monthly' | 'daily';
  baseSalaryPaise: number; // sensitive
  bankAccountNumber: string; // sensitive
  bankIfsc: string; // sensitive
  bankName: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  photoUrl: string;
  hasFaceEnrolled: boolean;
  faceEmbeddingId?: string;
  faceDescriptor?: number[];
  assignedShiftId?: string;
  isActive: boolean;
  demoFlag?: boolean;
}

export interface ShiftConfig {
  id: string;
  name: string;
  startTime: string; // HH:mm in 24h format, e.g. '07:00'
  endTime: string; // HH:mm in 24h format, e.g. '15:30'
  gracePeriodMinutes: number; // e.g. 15 minutes allowance before marked late
  halfDayHours: number; // e.g. 4.0 hours threshold
  color: 'emerald' | 'amber' | 'blue' | 'purple' | 'rose' | 'indigo' | 'cyan';
  description?: string;
}

export interface AttendanceLog {
  id: string;
  staffId: string;
  staffName: string;
  staffRole: string;
  staffPhotoUrl: string;
  date: string; // YYYY-MM-DD
  checkInTime?: string; // HH:MM or HH:MM AM/PM
  checkOutTime?: string; // HH:MM or HH:MM AM/PM
  hoursWorked: number;
  status: 'present' | 'absent' | 'late' | 'half_day' | 'on_leave' | 'override';
  verificationMethod: 'face_qr' | 'manager_override';
  faceConfidence?: number; // e.g. 99.4%
  overrideReason?: string;
  overrideBy?: string;
  shiftId?: string;
  shiftName?: string;
  shiftTiming?: string;
  isLate?: boolean;
  lateMinutes?: number;
  leftEarly?: boolean;
  leftEarlyMinutes?: number;
  isOvertime?: boolean;
  overtimeMinutes?: number;
  demoFlag?: boolean;
}

export interface LeaveRequest {
  id: string;
  staffId: string;
  staffName: string;
  startDate: string;
  endDate: string;
  leaveType: 'casual' | 'sick' | 'festival';
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  demoFlag?: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  category: string;
  phone: string;
  email: string;
  contactPerson: string;
  gstin: string;
  address: string;
  demoFlag?: boolean;
}

export interface InventoryItem {
  id: string;
  itemCode: string;
  name: string;
  category: string;
  unit: 'kg' | 'liters' | 'packets' | 'cylinders' | 'boxes' | 'tins' | 'pieces';
  currentStock: number;
  minimumReserve: number;
  costPerUnitPaise: number;
  supplierId: string;
  supplierName: string;
  lastRestockedDate: string;
  status: 'in_stock' | 'low_stock' | 'critical';
  demoFlag?: boolean;
}

export interface StockMovement {
  id: string;
  itemId: string;
  itemName: string;
  type: 'in_purchase' | 'out_kitchen_usage' | 'out_wastage_spoilage';
  quantity: number;
  unit: string;
  unitCostPaise: number;
  totalCostPaise: number;
  supplierId?: string;
  supplierName?: string;
  invoiceNumber?: string;
  recordedBy: string;
  notes?: string;
  date: string;
  demoFlag?: boolean;
}

export interface ExpenseEntry {
  id: string;
  category: 'Procurement' | 'Salaries' | 'Rent' | 'Electricity & Water' | 'Commercial Gas' | 'Repairs & Maintenance' | 'Marketing' | 'Miscellaneous';
  title: string;
  amountPaise: number;
  paymentMode: 'cash' | 'bank_transfer' | 'upi' | 'cheque';
  payee: string;
  referenceNumber?: string;
  receiptUrl?: string;
  date: string;
  recordedBy: string;
  demoFlag?: boolean;
}

export interface UpcomingLiability {
  id: string;
  title: string;
  amountPaise: number;
  dueDate: string;
  category: string;
  payee: string;
  urgency: 'due_today' | 'due_soon' | 'scheduled';
  demoFlag?: boolean;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userName: string;
  userRole: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'CANCEL_BILL' | 'APPLY_DISCOUNT' | 'ATTENDANCE_OVERRIDE' | 'CLEAR_DEMO_DATA' | 'RESTORE_DEMO_DATA';
  entityType: string;
  entityId: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
}

export interface DatabaseSchema {
  settings: BusinessSettings;
  users: User[];
  tables: RestaurantTable[];
  categories: MenuCategory[];
  menuItems: MenuItem[];
  orders: Order[];
  bills: Bill[];
  staff: Staff[];
  attendance: AttendanceLog[];
  shifts?: ShiftConfig[];
  leaveRequests: LeaveRequest[];
  suppliers: Supplier[];
  inventory: InventoryItem[];
  stockMovements: StockMovement[];
  expenses: ExpenseEntry[];
  liabilities: UpcomingLiability[];
  auditLogs: AuditLog[];
  nextBillSequence: number;
  nextOrderSequence: number;
}
