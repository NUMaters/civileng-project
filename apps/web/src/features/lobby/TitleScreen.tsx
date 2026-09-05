import heroImageUrl from "../../assets/civilcraft-abukuma-hero.webp";

type TitleScreenProps = {
  onEnter: () => void;
};

/** 起動直後のタイトル。治水体験を上品に伝える。 */
export function TitleScreen({ onEnter }: TitleScreenProps) {
  return (
    <section className="title-screen" aria-label="タイトル">
      <div className="title-screen__world" aria-hidden="true">
        <img className="title-screen__hero" src={heroImageUrl} alt="" />
        <div className="title-screen__gradient" />
      </div>

      <div className="title-screen__content">
        <p className="title-screen__locale">福島・郡山 — 阿武隈川</p>

        <div className="title-screen__brand">
          <p className="title-screen__eyebrow">河川治水シミュレーション</p>
          <h1 className="title-screen__logo" aria-label="CivilCraft">
            CivilCraft
          </h1>
          <p className="title-screen__tagline">
            堤防・遊水地・排水機場を配置し、大雨からまちを守る約3分のチャレンジ。
          </p>
        </div>

        <ol className="title-screen__steps" aria-label="ゲームの流れ">
          <li>
            <span>1</span>
            川を調べる
          </li>
          <li>
            <span>2</span>
            施設を配置
          </li>
          <li>
            <span>3</span>
            大雨に耐える
          </li>
        </ol>

        <button className="title-screen__cta" type="button" onClick={onEnter}>
          はじめる
        </button>
      </div>

      <p className="title-screen__foot">NU SoftCon 2026 · Civil Engineering × Game</p>
    </section>
  );
}
