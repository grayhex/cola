import { entitySocial } from "./entity-social.js";
const social = entitySocial("ride");
export const rideCommentQuery = social.query,
  rideCommentPage = social.page,
  rideReplyPage = social.replies,
  createRideComment = social.create,
  changeRideComment = social.change,
  likeRide = social.like;
