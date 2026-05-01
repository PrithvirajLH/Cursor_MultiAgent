import type { ReactNode, SVGProps } from 'react';

interface IcnProps extends Omit<SVGProps<SVGSVGElement>, 'd'> {
  d: ReactNode;
  s?: number;
  sw?: number;
}

export function Icn({ d, s = 14, sw = 1.5, ...rest }: IcnProps) {
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: 'none' }}
      aria-hidden="true"
      {...rest}
    >
      {d}
    </svg>
  );
}

export const I = {
  search:    <path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.3-4.3" />,
  bell:      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9Zm4 13a2 2 0 0 0 4 0" />,
  filter:    <path d="M3 5h18M6 12h12M10 19h4" />,
  plus:      <path d="M12 5v14M5 12h14" />,
  more:      <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  inbox:     <path d="M3 13h4l2 3h6l2-3h4M3 13l3-8h12l3 8M3 13v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6" />,
  ticket:    <path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-6Z M9 5v14" />,
  chart:     <path d="M3 21h18M7 17V11M12 17V7M17 17v-9" />,
  users:     <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-7.87a4 4 0 0 1 0 7.75" />,
  settings:  <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7-3a7 7 0 0 0-.1-1.2l2-1.6-2-3.5-2.5.8a7 7 0 0 0-2-1.2L14 3h-4l-.4 2.3a7 7 0 0 0-2 1.2l-2.5-.8-2 3.5 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.5 2.5-.8a7 7 0 0 0 2 1.2L10 21h4l.4-2.3a7 7 0 0 0 2-1.2l2.5.8 2-3.5-2-1.6c.07-.4.1-.8.1-1.2Z" />,
  arrowUp:   <path d="M12 19V5M5 12l7-7 7 7" />,
  arrowDown: <path d="M12 5v14M19 12l-7 7-7-7" />,
  clock:     <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert:     <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  check:     <path d="M20 6 9 17l-5-5" />,
  paperclip: <path d="m21 12.5-9 9a6 6 0 1 1-8.5-8.5l9-9a4 4 0 1 1 5.7 5.7l-9 9a2 2 0 1 1-2.8-2.8l8.3-8.3" />,
  send:      <path d="m22 2-7 20-4-9-9-4 20-7Z" />,
  x:         <path d="M18 6 6 18M6 6l12 12" />,
  chevR:     <path d="m9 6 6 6-6 6" />,
  chevD:     <path d="m6 9 6 6 6-6" />,
  link:      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />,
  tag:       <><path d="M20 12 12 20 3 11V3h8l9 9Z" /><circle cx="7.5" cy="7.5" r="1" /></>,
  shield:    <path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3Z" />,
  flag:      <path d="M4 21V4M4 4h12l-2 4 2 4H4" />,
  eye:       <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  pin:       <path d="M12 17v5M9 11V4h6v7l3 3v2H6v-2l3-3Z" />,
  reply:     <path d="M9 17 4 12l5-5M4 12h11a5 5 0 0 1 5 5v3" />,
  note:      <path d="M11 4H4v16h16v-7M19 3l-9 9v3h3l9-9-3-3Z" />,
  bolt:      <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />,
  msg:       <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10Z" />,
  history:   <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  sparkle:   <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />,
} as const;
