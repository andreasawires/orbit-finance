"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({ page, pageCount, pageSize, total, pageSizes, onPageChange, onPageSizeChange }: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  pageSizes: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(total, page * pageSize);
  return <div className="pagination">
    <span>Showing <strong>{first}–{last}</strong> of <strong>{total}</strong></span>
    <div>
      <label className="filter-select pagination-size"><span>Rows</span><select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} aria-label="Rows per page">{pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select><ChevronDown size={13} /></label>
      <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={15} /></button>
      <span className="pagination-page">Page {page} of {pageCount}</span>
      <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount} aria-label="Next page"><ChevronRight size={15} /></button>
    </div>
  </div>;
}
