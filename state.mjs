export function availableSpace(lesson, cart) {
  return Math.max(0, lesson.space - (cart[lesson._id] || 0));
}

export function sortLessons(lessons, cart, field = 'topic', direction = 'asc') {
  const sign = direction === 'desc' ? -1 : 1;
  return lessons.map((lesson) => ({ ...lesson, available: availableSpace(lesson, cart) })).sort((a, b) => {
    const first = field === 'space' ? a.available : a[field];
    const second = field === 'space' ? b.available : b[field];
    const result = ['price', 'space'].includes(field) ? first - second : String(first).localeCompare(String(second), 'en-GB', { sensitivity: 'base' });
    return result * sign || a._id.localeCompare(b._id);
  });
}

export function changeCart(lessons, cart, id, delta) {
  const lesson = lessons[id];
  if (![1, -1].includes(delta) || (delta === 1 && (!lesson || availableSpace(lesson, cart) === 0))) return cart;
  const quantity = Math.max(0, (cart[id] || 0) + delta);
  const updated = { ...cart };
  if (quantity) updated[id] = quantity;
  else delete updated[id];
  return updated;
}

export function cartLines(lessons, cart) {
  return Object.entries(cart).map(([id, quantity]) => ({
    ...(lessons[id] || { _id: id, topic: 'Unavailable lesson', location: '', price: 0, space: 0, missing: true }),
    quantity,
  }));
}

export function contactErrors(name, phone) {
  return {
    name: typeof name === 'string' && /^[A-Za-z]{1,100}$/.test(name.trim()) ? '' : 'Use letters A–Z only, without spaces or numbers.',
    phone: typeof phone === 'string' && /^[0-9]{1,30}$/.test(phone.trim()) ? '' : 'Use digits only, including any leading zero.',
  };
}

export function emailError(email = '') {
  return typeof email === 'string' && email.trim().length <= 254 &&
    (!email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    ? '' : 'Enter a valid email address or leave this optional field empty.';
}

export function formatPrice(price) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(price);
}
