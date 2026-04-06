export default function Loading() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', color: '#88726c',
    }}>
      <style>{`@keyframes loadSpin { to { transform: rotate(360deg); } }`}</style>
      <span
        className="material-symbols-outlined"
        style={{
          fontSize: 28,
          color: '#d97757',
          animation: 'loadSpin 1.2s ease-in-out infinite',
        }}
      >
        hourglass_top
      </span>
    </div>
  );
}
