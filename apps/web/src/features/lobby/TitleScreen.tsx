type TitleScreenProps = {
  onEnter: () => void;
};

/** 起動直後のタイトル。阿武隈川と治水の雰囲気を前面に出し、ブランドを主役にする。 */
export function TitleScreen({ onEnter }: TitleScreenProps) {
  return (
    <section className="title-screen" aria-label="タイトル">
      <div className="title-screen__world" aria-hidden="true">
        <div className="title-screen__sky" />
        <div className="title-screen__rain" />
        <div className="title-screen__glow" />
        <svg className="title-screen__terrain" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMax slice">
          <path
            className="title-screen__bank title-screen__bank--far"
            d="M0 210 C180 180 320 250 480 220 C640 190 760 140 920 160 C1040 174 1120 200 1200 188 L1200 420 L0 420 Z"
          />
          <path
            className="title-screen__water"
            d="M0 268 C160 248 300 300 460 278 C640 252 780 210 960 236 C1080 252 1140 270 1200 262 L1200 420 L0 420 Z"
          />
          <path
            className="title-screen__bank title-screen__bank--near"
            d="M0 330 C220 300 380 350 560 328 C760 302 900 270 1200 300 L1200 420 L0 420 Z"
          />
          <path
            className="title-screen__flow"
            d="M40 300 C220 286 360 318 520 304 C700 288 860 268 1160 292"
          />
        </svg>
      </div>

      <div className="title-screen__content">
        <p className="title-screen__locale">福島・郡山 · 阿武隈川流域</p>
        <div className="title-screen__brand">
          <h1 className="title-screen__logo">CivilCraft</h1>
          <p className="title-screen__tagline">土木の力で、まちを大雨から守ろう。</p>
        </div>
        <button className="title-screen__cta" type="button" onClick={onEnter}>
          はじめる
        </button>
      </div>

      <p className="title-screen__foot">NU SoftCon 2026 · 治水を学ぶシミュレーション</p>
    </section>
  );
}
