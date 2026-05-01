There are some sample payloads in these documents as well but here are a few that we recommend:

Shipped Yesterday.
{
                "MT_Status2Request": {
                                "StatusRequest": [{
                                                "ClientID": "90xxxxx",
                                                "TrackingData": "X",
                                                "ShipDate": "2026-03-02"
                                }]
                }
}
 
 
Specific PO.  Rule of thumb for From To.  Today minus 180 days
{
  "MT_Status2Request": {
    "StatusRequest": [
      {
        "ClientID": "93xxxxx",
        "TrackingData": "X",
        "OrderCreationDateFrom": "2026-02-08",
        "OrderCreationDateTo": "2026-03-02",
        "CustomerOrderNumber": [
          "PO001xxxx"
        ]
      }
    ]
  }
}
 