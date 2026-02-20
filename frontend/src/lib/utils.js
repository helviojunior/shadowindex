export function cn(...inputs) {
  const clsx = (...args) => {
    const classes = [];
    args.forEach(arg => {
      if (!arg) return;
      if (typeof arg === 'string') {
        classes.push(arg);
      } else if (Array.isArray(arg)) {
        classes.push(clsx(...arg));
      } else if (typeof arg === 'object') {
        Object.keys(arg).forEach(key => {
          if (arg[key]) classes.push(key);
        });
      }
    });
    return classes.join(' ');
  };

  const twMerge = (classes) => {
    return classes.split(' ').filter(Boolean).join(' ');
  };

  return twMerge(clsx(inputs));
}