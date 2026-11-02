// Job lifecycle. Office staff create and assign jobs; the assigned engineer
// moves them through travel, check-in and completion; office reviews.
export const STATUSES = ['unassigned', 'assigned', 'en_route', 'on_site', 'completed', 'returned', 'approved', 'cancelled'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const PHOTO_CATEGORIES = ['rack_front', 'rack_rear', 'cabling', 'labels', 'equipment', 'other', 'signature'];

export const ACTIONS = {
  start_travel: { from: ['assigned', 'returned'], to: 'en_route', by: 'engineer' },
  check_in: { from: ['assigned', 'en_route', 'returned'], to: 'on_site', by: 'engineer' },
  complete: { from: ['on_site'], to: 'completed', by: 'engineer' },
  approve: { from: ['completed'], to: 'approved', by: 'office' },
  return: { from: ['completed'], to: 'returned', by: 'office' },
  cancel: { from: ['unassigned', 'assigned', 'en_route', 'on_site', 'returned', 'completed'], to: 'cancelled', by: 'office' },
};

// Statuses in which the engineer can still change photos, checklist and assets.
export const EDITABLE_BY_ENGINEER = ['assigned', 'en_route', 'on_site', 'returned'];
export const CLOSED = ['approved', 'cancelled'];
