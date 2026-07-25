import { getHazardKindLabel, type HazardKind } from "@civilcraft/game-data/types";

export type HowtoFacilityGuide = {
  id: string;
  displayName: string;
  iconSrc: string;
  primaryHazard: HazardKind;
  /** ゲーム内で何をするか（1文）。 */
  role: string;
  /** 仕組みの要点（短く）。 */
  mechanism: string;
  /** 現実世界での用い方。 */
  realWorld: string;
  tip: string;
};

/** 遊び方画面の固定コピー。施設マスタの役割と現実の治水を対応させる。 */
export const HOWTO_PURPOSE = {
  title: "このゲームの目的",
  body: "阿武隈川沿いで大雨の氾濫からまちを守る治水チャレンジ。弱点に合う施設を、予算と時間の中で配置しよう。",
};

export const HOWTO_STEPS: { title: string; body: string }[] = [
  {
    title: "準備（60秒）",
    body: "ドックから黄色い配置帯へドラッグ → 向きを合わせ → ✓ で確定。",
  },
  {
    title: "大雨（90秒）",
    body: "雨の強さは波がある。足りなければ災害中も追加配置できる。",
  },
  {
    title: "クリア条件",
    body: "被災度 8% 未満。同じ施設の重ね置きだけでは足りない。相性の悪い場所は逆効果。",
  },
];

export const HOWTO_FACILITIES: HowtoFacilityGuide[] = [
  {
    id: "levee",
    displayName: "堤防",
    iconSrc: "/icons/structures/levee.svg",
    primaryHazard: "overtopping",
    role: "川の水が低岸からまちへ溢れ出すのを止める。",
    mechanism: "岸に沿って土やコンクリートの壁を造り、水位が上がっても市街地へ流れ込ませない。向きを川沿いに合わせると効果が高い。",
    realWorld: "日本の河川で最も基本的な治水施設。計画高水位を想定した高さ・断面で連続して築かれ、越水や破堤の防止が目的。",
    tip: "内水地点に置くと排水を妨げ、逆効果になることがある。",
  },
  {
    id: "revetment",
    displayName: "護岸",
    iconSrc: "/icons/structures/revetment.svg",
    primaryHazard: "erosion",
    role: "流れで削られる河岸を固め、岸崩れを防ぐ。",
    mechanism: "石・コンクリートなどで河岸表面を保護し、湾曲部など流速が速い場所の侵食を抑える。溢れそのものは止められない。",
    realWorld: "蛇行部や橋脚周辺など、河岸が削られやすい区間に施工。根固めや法覆工と組み合わせ、河道の形状を保つ。",
    tip: "湾曲の侵食点向け。越水対策の代わりにはならない。",
  },
  {
    id: "drainage-pump",
    displayName: "排水機場",
    iconSrc: "/icons/structures/drainage-pump.svg",
    primaryHazard: "inlandPonding",
    role: "まち側にたまった内水を川や排水路へ吐き出す。",
    mechanism: "ポンプで低地の水を強制排水する。外水（川からの溢れ）そのものは止められない。",
    realWorld: "ゼロメートル地帯や都市の低平地で、下水道や河川への自然排水が難しいときに使われる。雨水ポンプ場とも呼ばれる。",
    tip: "決壊口（越水点）に置くとほぼ効かず、状況を悪化させうる。",
  },
  {
    id: "retention-basin",
    displayName: "遊水地",
    iconSrc: "/icons/structures/retention-basin.svg",
    primaryHazard: "capacityShortage",
    role: "増水のピークを一時貯留し、下流の水位を抑える。",
    mechanism: "河道の一部や周囲の低地に洪水を導き、ピーク流量をカットしてからゆっくり戻す。決壊口を塞ぐ施設ではない。",
    realWorld: "渡良瀬遊水地など、日本各地の大河川で採用。平時は農地や自然地、洪水時は貯留空間として機能する。",
    tip: "水位ピーク削りに有効。侵食箇所の固めには向かない。",
  },
  {
    id: "channel-dredging",
    displayName: "河道掘削",
    iconSrc: "/icons/structures/channel-dredging.svg",
    primaryHazard: "capacityShortage",
    role: "川底や河道を広げ、流せる水量を増やす。",
    mechanism: "土砂を取り除き断面を大きくすることで水位を下げ、流下能力を高める。湾曲部では流速が増し侵食を悪化させうる。",
    realWorld: "堆積した土砂の浚渫や低水路掘削として全国の河川で実施。維持管理とセットで、再び堆砂しないよう計画する。",
    tip: "水位低下に効くが、湾曲の侵食点では護岸とセットで考える。",
  },
];

export function hazardChipLabel(kind: HazardKind): string {
  return `対 ${getHazardKindLabel(kind)}`;
}
