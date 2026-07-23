type TitleScreenProps = {
  onEnter: () => void;
};

/** 起動直後のタイトル。ブランドを大きく出し、タップでメニューへ。 */
export function TitleScreen({ onEnter }: TitleScreenProps) {
  return (
    <section className="title-screen" aria-label="タイトル">
      <div className="title-screen__atmosphere" aria-hidden="true" />
      <div className="title-screen__brand">
        <span className="title-screen__mark" aria-hidden="true">
          <span className="title-screen__wave" />
          CC
        </span>
        <h1 className="title-screen__logo">CivilCraft</h1>
        <p className="title-screen__tagline">阿武隈川を守れ。土木の力でまちを防衛せよ。</p>
      </div>
      <button className="title-screen__cta" type="button" onClick={onEnter}>
        タップして開始
      </button>
      <p className="title-screen__foot">NU SoftCon 2026 · 福島・郡山</p>
    </section>
  );
}
