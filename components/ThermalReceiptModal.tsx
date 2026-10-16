'use client';

import React from 'react';
import { Bill, BusinessSettings } from '../lib/types';

interface ThermalReceiptModalProps {
  bill: Bill;
  settings: BusinessSettings;
  onClose: () => void;
}

export const ThermalReceiptModal: React.FC<ThermalReceiptModalProps> = ({
  bill,
  settings,
  onClose,
}) => {
  const handlePrint = () => {
    window.print();
  };

  const formattedDate = new Date(bill.createdAt).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const formattedTime = new Date(bill.createdAt).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
    >
      <div className="bg-white max-w-md w-full rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150">
        {/* Modal Top Actions */}
        <div className="p-4 bg-slate-50 border-b border-slate-200/80 flex items-center justify-between no-print">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200/60 flex items-center justify-center">
              <span className="material-symbols-outlined text-base">receipt_long</span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                80mm Thermal Receipt Preview
              </h3>
              <span className="text-[11px] font-mono font-bold text-emerald-700">
                {bill.billNumber}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm flex items-center gap-1.5 transition-all active:scale-95"
            >
              <span className="material-symbols-outlined text-sm">print</span>
              Print Bill
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"
              title="Close Preview"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          </div>
        </div>

        {/* Scrollable Receipt Area */}
        <div className="p-4 overflow-y-auto flex justify-center bg-slate-100/60">
          {/* Printable Thermal Receipt Container */}
          <div
            id="thermal-receipt-printable"
            className="w-[300px] bg-white text-slate-900 p-4 font-mono text-[11px] leading-tight shadow-md border border-slate-300 rounded-lg"
          >
            {/* Header */}
            <div className="text-center pb-2 border-b border-dashed border-slate-400">
              <h2 className="font-bold text-sm tracking-tight uppercase text-slate-950 font-sans">
                {settings.restaurantName}
              </h2>
              {settings.tagline && (
                <p className="text-[8.5px] text-slate-600 font-sans font-medium mt-0.5 leading-snug">{settings.tagline}</p>
              )}
              <p className="text-[8.5px] text-slate-600 mt-0.5 leading-snug px-1">{settings.address}</p>
              <p className="text-[8.5px] text-slate-600 mt-0.5 leading-snug">Ph: {settings.phone}</p>
              <p className="text-[9px] font-bold mt-1 text-slate-800 leading-tight">
                GSTIN: {settings.gstin}
              </p>
              <p className="text-[9px] text-slate-600 leading-tight">
                FSSAI Lic: {settings.fssai}
              </p>
            </div>

            {/* Bill Meta */}
            <div className="py-2 border-b border-dashed border-slate-400 text-[10px] space-y-0.5">
              <div className="flex justify-between font-bold text-slate-900">
                <span>BILL: {bill.billNumber}</span>
                <span>TABLE: {bill.tableNumber}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Date: {formattedDate}</span>
                <span>Time: {formattedTime}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Steward: {bill.stewardName}</span>
                <span>Guests: {bill.guestCount}</span>
              </div>
              <div className="flex justify-between pt-0.5">
                <span>Tender: <strong className="uppercase text-slate-900">{bill.paymentMode || 'PAID'}</strong></span>
                <span className="font-bold text-emerald-700 bg-emerald-50 px-1 rounded">PAID</span>
              </div>
            </div>

            {/* Items Table */}
            <div className="py-2 border-b border-dashed border-slate-400">
              <div className="flex justify-between font-bold pb-1 text-[10px] border-b border-slate-300 text-slate-700 uppercase">
                <span className="w-1/2 text-left">ITEM</span>
                <span className="w-1/6 text-center">QTY</span>
                <span className="w-1/6 text-right">RATE</span>
                <span className="w-1/6 text-right">AMT</span>
              </div>
              <div className="divide-y divide-dashed divide-slate-200 py-1">
                {bill.items.map((item, index) => (
                  <div key={index} className="flex justify-between py-1 text-[10px]">
                    <span className="w-1/2 text-left truncate font-sans font-medium pr-1 text-slate-900">
                      {item.name}
                    </span>
                    <span className="w-1/6 text-center font-bold">{item.quantity}</span>
                    <span className="w-1/6 text-right">{(item.pricePaise / 100).toFixed(0)}</span>
                    <span className="w-1/6 text-right font-bold">{(item.totalPaise / 100).toFixed(0)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Totals & Tax Breakdown */}
            <div className="py-2 border-b border-dashed border-slate-400 space-y-1 text-[10px]">
              <div className="flex justify-between text-slate-700">
                <span>Subtotal:</span>
                <span>₹{(bill.subtotalPaise / 100).toFixed(2)}</span>
              </div>
              {bill.discountPaise > 0 && (
                <div className="flex justify-between text-rose-600 font-bold">
                  <span>Discount ({bill.discountPercent}%):</span>
                  <span>-₹{(bill.discountPaise / 100).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-600">
                <span>CGST ({settings.cgstPercent}%):</span>
                <span>₹{(bill.cgstPaise / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>SGST ({settings.sgstPercent}%):</span>
                <span>₹{(bill.sgstPaise / 100).toFixed(2)}</span>
              </div>
              {bill.serviceChargePaise > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Service Charge:</span>
                  <span>₹{(bill.serviceChargePaise / 100).toFixed(2)}</span>
                </div>
              )}
              {Boolean(bill.roundOffPaise) && (
                <div className="flex justify-between text-slate-600">
                  <span>Round Off:</span>
                  <span>₹{((bill.roundOffPaise || 0) / 100).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs font-black pt-1.5 border-t border-slate-900 text-slate-950">
                <span>NET INVOICE TOTAL:</span>
                <span className="text-sm font-sans font-black">₹{(bill.totalPaise / 100).toLocaleString('en-IN')}</span>
              </div>
            </div>

            {/* Thermal Footer */}
            <div className="text-center pt-2.5 space-y-1 text-[10px]">
              <p className="font-bold text-slate-900">THANK YOU! VISIT AGAIN</p>
              <p className="text-[9px] text-slate-500">
                {settings.billFooter || 'GST Inclusive Bill • Save Water & Food'}
              </p>
              <div className="w-14 h-14 border border-slate-300 mx-auto flex items-center justify-center p-1 my-1.5 bg-slate-50 rounded">
                <span className="material-symbols-outlined text-3xl text-slate-700">qr_code_2</span>
              </div>
              <p className="text-[8px] text-slate-400">Scan to Review &amp; Pay</p>
            </div>
          </div>
        </div>

        {/* Modal Bottom Action Bar */}
        <div className="p-3 bg-slate-50 border-t border-slate-200/80 flex items-center justify-between gap-3 no-print">
          <span className="text-xs text-slate-500 font-medium">
            Thermal Width: <strong className="text-slate-800">80mm ESC/POS</strong>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold transition-colors"
            >
              Close &amp; Return to POS
            </button>
            <button
              onClick={handlePrint}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm flex items-center gap-1.5 transition-all"
            >
              <span className="material-symbols-outlined text-sm">print</span>
              Print Receipt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
