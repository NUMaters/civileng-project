import heroImageUrl from "../../../../../assets/generated/civilcraft-abukuma-hero.webp";

type TitleScreenProps = {
  onEnter: () => void;
};

/** 起動直後のタイトル。治水の学びを、明るい街づくりゲームとして見せる。 */
export function TitleScreen({ onEnter }: TitleScreenProps) {
  return (
    <section className="title-screen" aria-label="タイトル">
      <div className="title-screen__world" aria-hidden="true">
        <img className="title-screen__hero" src={heroImageUrl} alt="" />
        <div className="title-screen__wash" />
        <i className="title-screen__bubble title-screen__bubble--one" />
        <i className="title-screen__bubble title-screen__bubble--two" />
        <i className="title-screen__bubble title-screen__bubble--three" />
        <span className="title-screen__spark title-screen__spark--one">✦</span>
        <span className="title-screen__spark title-screen__spark--two">●</span>
        <span className="title-screen__spark title-screen__spark--three">◆</span>
      </div>

      <div className="title-screen__content">
        <p className="title-screen__locale">
          <span aria-hidden="true">📍</span> 福島・郡山 · 阿武隈川
        </p>

        <div className="title-screen__brand">
          <p className="title-screen__eyebrow">
            <span aria-hidden="true">水</span> まちを守る、川づくりゲーム
          </p>
          <h1 className="title-screen__logo" aria-label="CivilCraft">
            <span>Civil</span>
            <span>Craft</span>
          </h1>
          <p className="title-screen__tagline">
            <strong>土木の力を、ゲームで体験！</strong>
            堤防や遊水地をつくって、大雨からまちを守ろう。
          </p>
        </div>

        <div className="title-screen__badges" aria-label="ゲームの流れ">
          <span>
            <b>1</b> 川をみる
          </span>
          <span>
            <b>2</b> 施設をおく
          </span>
          <span>
            <b>3</b> まちを守る
          </span>
        </div>

        <button className="title-screen__cta" type="button" onClick={onEnter}>
          <span className="title-screen__cta-icon" aria-hidden="true">
            ▶
          </span>
          <span>
            <strong>ゲームをはじめる</strong>
            <small>約3分の治水チャレンジ</small>
          </span>
        </button>
      </div>

      <div className="title-screen__sticker" aria-hidden="true">
        <strong>LET&apos;S</strong>
        <span>治水！</span>
      </div>

      <p className="title-screen__foot">NU SoftCon 2026 · Civil Engineering × Game</p>
    </section>
  );
}
