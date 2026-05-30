/* Connection history entity */

package com.freerdp.freerdpcore.data;

import androidx.annotation.NonNull;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

import java.util.Date;

@Entity(tableName = "quick_connect_history") public class HistoryEntity
{
	@PrimaryKey @ColumnInfo(name = "item") @NonNull public String item;

	@ColumnInfo(name = "timestamp") public long timestamp;

	public HistoryEntity(@NonNull String item)
	{
		this.item = item;
		this.timestamp = new Date().getTime();
	}
}
