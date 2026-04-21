import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/auth";
import { fetchOrderForCustoms } from "@/lib/shopify";
import { generateCN23PDF } from "@/lib/generate-cn23-pdf";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  await requireFeature("customs_ch");
  const { orderId } = await params;
  const numericId = orderId.replace(/\D/g, "");
  if (!numericId) return new NextResponse("Invalid order id", { status: 400 });

  const order = await fetchOrderForCustoms(numericId);
  if (!order) return new NextResponse("Order not found", { status: 404 });

  const buffer = generateCN23PDF(order);
  const safeName = order.name.replace(/[^a-z0-9#_-]/gi, "");
  const filename = `CN23_${safeName || numericId}.pdf`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
