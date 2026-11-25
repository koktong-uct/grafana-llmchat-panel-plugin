import { css, keyframes } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

/**
 * Silver "glass" look that pairs with the Dark Veil silver preset.
 * Everything derives from the Grafana theme so light mode stays legible.
 */
const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const shimmer = keyframes`
  0%   { background-position: 120% 0; }
  100% { background-position: -120% 0; }
`;

const breathe = keyframes`
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 1; }
`;

export const getChatStyles = (theme: GrafanaTheme2) => {
  const dark = theme.isDark;

  const t = {
    glass: dark ? 'rgba(255, 255, 255, 0.035)' : 'rgba(255, 255, 255, 0.62)',
    glassHover: dark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 255, 255, 0.9)',
    bar: dark ? 'rgba(14, 15, 19, 0.55)' : 'rgba(250, 250, 252, 0.72)',
    line: dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(20, 20, 40, 0.09)',
    lineStrong: dark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(20, 20, 40, 0.2)',
    silver: dark
      ? 'linear-gradient(135deg, #fbfbfd 0%, #d2d2dc 42%, #9a9aae 100%)'
      : 'linear-gradient(135deg, #3b3b4a 0%, #262632 55%, #15151d 100%)',
    onSilver: dark ? '#101117' : '#f4f4f8',
    titleGradient: dark
      ? 'linear-gradient(180deg, #ffffff 10%, #b4b4c4 100%)'
      : 'linear-gradient(180deg, #15151d 10%, #5a5a6e 100%)',
    halo: dark ? 'rgba(180, 180, 196, 0.22)' : 'rgba(60, 60, 80, 0.14)',
    shadow: dark ? '0 8px 30px rgba(0, 0, 0, 0.35)' : '0 8px 24px rgba(20, 20, 40, 0.08)',
  };

  const blur = 'blur(16px) saturate(140%)';

  return {
    root: css({
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      borderRadius: theme.shape.radius.default,
      background: theme.colors.background.primary,
      color: theme.colors.text.primary,
      fontSize: 13,
    }),

    // ---------- Background ----------
    veil: css({
      position: 'absolute',
      inset: 0,
      zIndex: 0,
      pointerEvents: 'none',
      transition: 'opacity 900ms ease',
    }),
    // Keeps text readable over the brightest parts of the veil.
    scrim: css({
      position: 'absolute',
      inset: 0,
      zIndex: 0,
      pointerEvents: 'none',
      transition: 'opacity 900ms ease',
      background: dark
        ? 'radial-gradient(120% 90% at 50% 40%, rgba(10,11,14,0) 0%, rgba(10,11,14,0.45) 70%, rgba(10,11,14,0.75) 100%)'
        : 'radial-gradient(120% 90% at 50% 40%, rgba(255,255,255,0) 0%, rgba(255,255,255,0.4) 75%)',
    }),

    shell: css({
      position: 'relative',
      zIndex: 1,
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      minHeight: 0,
    }),

    // ---------- Header ----------
    header: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '10px 14px',
      flexShrink: 0,
      background: t.bar,
      backdropFilter: blur,
      borderBottom: `1px solid ${t.line}`,
    }),
    brand: css({
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      minWidth: 0,
    }),
    title: css({
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: '0.01em',
      lineHeight: 1.2,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }),
    status: css({
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      marginTop: 2,
      fontSize: 11,
      color: theme.colors.text.secondary,
      whiteSpace: 'nowrap',
    }),
    statusDot: css({
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: theme.colors.success.main,
      boxShadow: `0 0 6px ${theme.colors.success.main}`,
      animation: `${breathe} 2.4s ease-in-out infinite`,
    }),
    statusDotBusy: css({
      background: theme.colors.warning.main,
      boxShadow: `0 0 6px ${theme.colors.warning.main}`,
      animationDuration: '0.9s',
    }),
    ghostButton: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 28,
      padding: '0 10px',
      borderRadius: 8,
      border: `1px solid ${t.line}`,
      background: t.glass,
      color: theme.colors.text.secondary,
      fontSize: 12,
      fontWeight: 500,
      cursor: 'pointer',
      transition: 'all 160ms ease',
      flexShrink: 0,
      '&:hover:not(:disabled)': {
        color: theme.colors.text.primary,
        borderColor: t.lineStrong,
        background: t.glassHover,
      },
      '&:disabled': {
        opacity: 0.4,
        cursor: 'default',
      },
    }),

    // ---------- Orb avatar ----------
    orb: css({
      position: 'relative',
      flexShrink: 0,
      borderRadius: '50%',
      background: t.silver,
      boxShadow: `0 0 0 1px ${t.line}, 0 0 14px ${t.halo}`,
      overflow: 'hidden',
      '&::after': {
        content: '""',
        position: 'absolute',
        inset: '-30%',
        background:
          'conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.75) 40deg, transparent 90deg, transparent 360deg)',
        mixBlendMode: dark ? 'overlay' : 'soft-light',
        animation: `${spin} 6s linear infinite`,
      },
    }),
    orbBusy: css({
      '&::after': { animationDuration: '1.1s' },
    }),

    // ---------- Conversation ----------
    scroller: css({
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: '18px 16px 8px',
      scrollbarWidth: 'thin',
      scrollbarColor: `${t.lineStrong} transparent`,
    }),

    // Empty state
    hero: css({
      minHeight: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: '8px 4px 20px',
    }),
    eyebrow: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      borderRadius: 999,
      border: `1px solid ${t.line}`,
      background: t.glass,
      backdropFilter: blur,
      fontSize: 10.5,
      fontWeight: 500,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: theme.colors.text.secondary,
      animation: `${fadeUp} 500ms ease both`,
    }),
    heroTitle: css({
      margin: '14px 0 0',
      fontSize: 'clamp(20px, 3.2vw, 28px)',
      fontWeight: 600,
      letterSpacing: '-0.02em',
      lineHeight: 1.15,
      background: t.titleGradient,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      animation: `${fadeUp} 500ms ease 60ms both`,
    }),
    heroSub: css({
      maxWidth: 420,
      margin: '8px 0 0',
      fontSize: 12.5,
      lineHeight: 1.55,
      color: theme.colors.text.secondary,
      animation: `${fadeUp} 500ms ease 120ms both`,
    }),
    promptGrid: css({
      width: '100%',
      maxWidth: 640,
      marginTop: 22,
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      gap: 8,
    }),
    promptCard: css({
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '9px 10px',
      textAlign: 'left',
      borderRadius: 12,
      border: `1px solid ${t.line}`,
      background: t.glass,
      backdropFilter: blur,
      color: theme.colors.text.primary,
      fontSize: 12,
      lineHeight: 1.35,
      cursor: 'pointer',
      animation: `${fadeUp} 450ms ease both`,
      transition: 'border-color 160ms ease, background 160ms ease, transform 160ms ease',
      '& .prompt-arrow': {
        marginLeft: 'auto',
        opacity: 0,
        transform: 'translateX(-4px)',
        transition: 'all 160ms ease',
        color: theme.colors.text.secondary,
      },
      '&:hover:not(:disabled)': {
        borderColor: t.lineStrong,
        background: t.glassHover,
        transform: 'translateY(-1px)',
        '& .prompt-arrow': { opacity: 1, transform: 'translateX(0)' },
      },
      '&:focus-visible': {
        outline: 'none',
        boxShadow: `0 0 0 2px ${t.lineStrong}`,
      },
      '&:disabled': { opacity: 0.5, cursor: 'default' },
    }),
    promptIcon: css({
      display: 'grid',
      placeItems: 'center',
      width: 26,
      height: 26,
      flexShrink: 0,
      borderRadius: 8,
      background: t.glassHover,
      border: `1px solid ${t.line}`,
      color: theme.colors.text.secondary,
    }),

    // Messages
    row: css({
      display: 'flex',
      gap: 10,
      marginBottom: 16,
      animation: `${fadeUp} 280ms ease both`,
    }),
    rowUser: css({
      justifyContent: 'flex-end',
    }),
    assistantColumn: css({
      minWidth: 0,
      maxWidth: 'min(88%, 760px)',
      '&:hover .msg-actions': { opacity: 1 },
    }),
    author: css({
      margin: '2px 0 6px',
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.02em',
      color: theme.colors.text.secondary,
    }),
    toolActivity: css({
      marginBottom: 8,
      color: theme.colors.text.secondary,
      fontSize: 12,
      '& summary': {
        width: 'fit-content',
        padding: '3px 6px',
        borderRadius: 4,
        cursor: 'pointer',
        '&:hover': { background: t.glassHover, color: theme.colors.text.primary },
        '&:focus-visible': { outline: '2px solid currentColor', outlineOffset: 2 },
      },
      '& ol': { margin: '4px 0 0', padding: '3px 0 3px 12px', borderLeft: `1px solid ${t.lineStrong}` },
      '& li': { display: 'block', padding: '3px 0' },
    }),
    toolActivityHeading: css({
      display: 'flex',
      gap: 12,
      justifyContent: 'space-between',
      '& span:last-child': { flexShrink: 0 },
    }),
    toolEvidence: css({
      marginTop: 2,
      fontSize: 11,
      overflowWrap: 'anywhere',
    }),
    metricSummary: css({
      marginTop: 8,
      padding: '8px 10px',
      border: `1px solid ${t.line}`,
      borderRadius: 8,
      background: t.glass,
    }),
    metricTableScroll: css({
      overflowX: 'auto',
      '& caption': {
        textAlign: 'left',
        color: theme.colors.text.secondary,
        fontSize: 11,
        marginBottom: 4,
      },
    }),
    metricSummaryNote: css({
      marginLeft: 6,
      color: theme.colors.text.secondary,
      fontSize: 11,
    }),
    userBubble: css({
      maxWidth: 'min(78%, 620px)',
      padding: '9px 13px',
      borderRadius: '16px 16px 4px 16px',
      background: t.silver,
      color: t.onSilver,
      fontSize: 12.5,
      lineHeight: 1.55,
      fontWeight: 500,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      boxShadow: t.shadow,
    }),
    assistantCard: css({
      padding: '11px 14px',
      borderRadius: '4px 16px 16px 16px',
      border: `1px solid ${t.line}`,
      background: dark ? 'rgba(22, 23, 29, 0.72)' : 'rgba(255, 255, 255, 0.82)',
      backdropFilter: blur,
      boxShadow: t.shadow,
      fontSize: 12.5,
      lineHeight: 1.62,
      wordBreak: 'break-word',
    }),
    errorCard: css({
      borderColor: theme.colors.error.border,
      background: dark ? 'rgba(60, 18, 22, 0.55)' : 'rgba(255, 240, 240, 0.9)',
      color: theme.colors.error.text,
      display: 'flex',
      gap: 8,
      alignItems: 'flex-start',
      whiteSpace: 'pre-wrap',
    }),
    markdown: css({
      '& > :first-child': { marginTop: 0 },
      '& > :last-child': { marginBottom: 0 },
      '& p': { margin: '0 0 0.65em' },
      '& ul, & ol': { margin: '0 0 0.65em', paddingLeft: '1.3em' },
      '& li': { margin: '0.15em 0' },
      '& li::marker': { color: theme.colors.text.secondary },
      '& strong': { color: theme.colors.text.maxContrast, fontWeight: 600 },
      '& h1, & h2, & h3, & h4': {
        margin: '0.9em 0 0.4em',
        fontSize: 13,
        fontWeight: 600,
        color: theme.colors.text.maxContrast,
      },
      '& code': {
        padding: '1px 5px',
        borderRadius: 5,
        background: t.glassHover,
        border: `1px solid ${t.line}`,
        fontFamily: theme.typography.fontFamilyMonospace,
        fontSize: '0.92em',
      },
      '& pre': {
        margin: '0 0 0.65em',
        padding: '8px 10px',
        borderRadius: 8,
        background: t.glass,
        border: `1px solid ${t.line}`,
        overflowX: 'auto',
        '& code': { padding: 0, border: 'none', background: 'none' },
      },
      '& table': {
        display: 'block',
        maxWidth: '100%',
        overflowX: 'auto',
        borderCollapse: 'collapse',
        margin: '0 0 0.65em',
        fontSize: 12,
      },
      '& th, & td': {
        padding: '5px 10px',
        borderBottom: `1px solid ${t.line}`,
        textAlign: 'left',
        whiteSpace: 'nowrap',
      },
      '& th': { color: theme.colors.text.secondary, fontWeight: 600 },
      '& a': { color: theme.colors.text.link },
      '& hr': { border: 0, borderTop: `1px solid ${t.line}`, margin: '0.8em 0' },
    }),
    actions: css({
      display: 'flex',
      gap: 4,
      marginTop: 4,
      opacity: 0,
      transition: 'opacity 160ms ease',
      '&:focus-within': { opacity: 1 },
    }),
    actionButton: css({
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      height: 22,
      padding: '0 7px',
      borderRadius: 6,
      border: 'none',
      background: 'transparent',
      color: theme.colors.text.secondary,
      fontSize: 11,
      cursor: 'pointer',
      '&:hover': { background: t.glassHover, color: theme.colors.text.primary },
    }),

    thinking: css({
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    }),
    shimmerText: css({
      fontSize: 12.5,
      fontWeight: 500,
      background: `linear-gradient(90deg, ${theme.colors.text.secondary} 0%, ${theme.colors.text.secondary} 35%, ${theme.colors.text.maxContrast} 50%, ${theme.colors.text.secondary} 65%, ${theme.colors.text.secondary} 100%)`,
      backgroundSize: '220% 100%',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      animation: `${shimmer} 2.2s linear infinite`,
    }),

    // ---------- Composer ----------
    composer: css({
      flexShrink: 0,
      padding: '8px 14px 10px',
    }),
    inputShell: css({
      display: 'flex',
      alignItems: 'flex-end',
      gap: 8,
      padding: '6px 6px 6px 14px',
      borderRadius: 16,
      border: `1px solid ${t.line}`,
      background: t.bar,
      backdropFilter: blur,
      boxShadow: t.shadow,
      transition: 'border-color 160ms ease, box-shadow 160ms ease',
      '&:focus-within': {
        borderColor: t.lineStrong,
        boxShadow: `${t.shadow}, 0 0 0 3px ${t.halo}`,
      },
    }),
    textarea: css({
      flex: 1,
      minWidth: 0,
      maxHeight: 132,
      padding: '7px 0',
      border: 'none',
      outline: 'none',
      resize: 'none',
      background: 'transparent',
      color: theme.colors.text.primary,
      fontFamily: 'inherit',
      fontSize: 13,
      lineHeight: 1.45,
      '&::placeholder': { color: theme.colors.text.disabled },
      '&:disabled': { cursor: 'not-allowed' },
    }),
    sendButton: css({
      display: 'grid',
      placeItems: 'center',
      width: 32,
      height: 32,
      flexShrink: 0,
      borderRadius: 11,
      border: 'none',
      background: t.silver,
      color: t.onSilver,
      cursor: 'pointer',
      boxShadow: `0 0 16px ${t.halo}`,
      transition: 'transform 140ms ease, opacity 140ms ease, box-shadow 140ms ease',
      '&:hover:not(:disabled)': { transform: 'translateY(-1px)', boxShadow: `0 0 22px ${t.halo}` },
      '&:active:not(:disabled)': { transform: 'scale(0.96)' },
      '&:disabled': {
        background: t.glassHover,
        color: theme.colors.text.disabled,
        boxShadow: 'none',
        cursor: 'default',
      },
    }),
    hint: css({
      marginTop: 6,
      textAlign: 'center',
      fontSize: 10.5,
      color: theme.colors.text.disabled,
      '& kbd': {
        padding: '0 4px',
        borderRadius: 4,
        border: `1px solid ${t.line}`,
        fontFamily: 'inherit',
        fontSize: 10,
      },
    }),
  };
};
