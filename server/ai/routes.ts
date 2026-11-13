import { z } from 'zod';
import { parkCatalog } from '../../src/data/park-catalog.js';

// The model selects the stops and their order; only the server supplies map coordinates.
const routePois = parkCatalog.filter(poi => poi.locationVerified && poi.position);
const poiIds = routePois.map(poi => poi.id) as [string, ...string[]];
const poiId = z.enum(poiIds).describe(`可规划的园内景点 ID：${routePois.map(poi => `${poi.id}=${poi.name}（${poi.region}）`).join('；')}`);

export const routeSchema = z.object({
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(500).describe('结合用户需求说明路线安排，不承诺实时开放、最短路径或精确时长'),
  stops: z.array(z.object({
    poi_id: poiId,
    reason: z.string().trim().min(1).max(200).describe('该站的游览建议或选择原因，基于已查询的景点资料'),
  }).strict()).min(2).max(12).refine(stops => new Set(stops.map(stop => stop.poi_id)).size === stops.length, '路线不能包含重复景点'),
}).strict();

export function planRoute({ title, summary, stops }: z.infer<typeof routeSchema>) {
  return {
    status: 'success',
    route: {
      title, summary, kind: 'llm-suggested',
      stops: stops.map(stop => {
        const poi = routePois.find(poi => poi.id === stop.poi_id)!;
        return { poiId: poi.id, name: poi.name, region: poi.region, position: poi.position, source: poi.source, reason: stop.reason };
      }),
      disclaimer: 'LLM 游览建议；地图虚线仅表示游览顺序，不是实际步行道路或最短路径。未核实当天开放、排队和通行情况，请以现场指示为准。',
    },
  };
}
